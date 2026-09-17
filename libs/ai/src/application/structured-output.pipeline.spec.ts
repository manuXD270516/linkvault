import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { CompletionRequest } from '../domain/ports/llm-provider.port';
import {
  runStructuredOutput,
  StructuredOutputProviderError,
} from './structured-output.pipeline';
import { FakeLlmProvider } from './testing/fake-llm-provider';

// Escenarios de "Salida estructurada validada con una reparación" (specs/ai/task-execution) y D3.

const outputSchema = z.object({
  skills: z.array(z.object({ name: z.string().min(1) })),
});

const request: CompletionRequest = {
  system: 'Sistema',
  user: 'Clasifica: TypeScript',
  temperature: 0,
  maxTokens: 256,
  responseFormat: 'json',
};

const VALID = '{"skills":[{"name":"TypeScript"}]}';
const INVALID = '{"skills":[{"name":""}]}';

function run(provider: FakeLlmProvider, maxAttempts = 2) {
  return runStructuredOutput({
    complete: (req) => provider.complete(req),
    request,
    outputSchema,
    maxAttempts,
  });
}

describe('runStructuredOutput', () => {
  it('JSON dentro de un bloque de código', async () => {
    const provider = new FakeLlmProvider('p', [
      `Aquí está:\n\`\`\`json\n${VALID}\n\`\`\`\nSaludos.`,
    ]);

    const result = await run(provider);

    expect(result).toMatchObject({
      status: 'valid',
      output: { skills: [{ name: 'TypeScript' }] },
      repairs: 0,
    });
    expect(provider.calls).toBe(1);
  });

  it('JSON inválido en el primer intento', async () => {
    const provider = new FakeLlmProvider('p', [INVALID, VALID], {
      usage: { inputTokens: 10, outputTokens: 3 },
    });

    const result = await run(provider);

    expect(result).toMatchObject({
      status: 'valid',
      output: { skills: [{ name: 'TypeScript' }] },
      repairs: 1,
      usage: { inputTokens: 20, outputTokens: 6 },
    });
    expect(provider.calls).toBe(2);
    const repair = provider.requests[1];
    expect(repair?.system).toBe(request.system);
    expect(repair?.user).toContain(request.user);
    expect(repair?.user).toContain(INVALID);
    expect(repair?.user).toContain('skills[0].name');
    expect(repair?.temperature).toBe(0);
    expect(repair?.responseFormat).toBe('json');
  });

  it('does not repair when maxAttempts is 1', async () => {
    const provider = new FakeLlmProvider('p', [INVALID, VALID]);

    const result = await run(provider, 1);

    expect(result).toMatchObject({ status: 'invalid', repairs: 0 });
    expect(provider.calls).toBe(1);
  });

  it('reports invalid after exactly one failed repair', async () => {
    const provider = new FakeLlmProvider('p', [INVALID, 'sin json', VALID]);

    const result = await run(provider);

    expect(result.status).toBe('invalid');
    expect(result.repairs).toBe(1);
    expect(provider.calls).toBe(2);
  });

  it('asks for a repair when the response has no JSON at all', async () => {
    const provider = new FakeLlmProvider('p', ['Lo siento, no puedo.', VALID]);

    const result = await run(provider);

    expect(result.status).toBe('valid');
    expect(provider.requests[1]?.user).toContain('no contiene un objeto JSON');
  });

  it('wraps a provider error keeping the usage of earlier responses', async () => {
    const cause = new Error('network down');
    const provider = new FakeLlmProvider('p', [INVALID, cause], {
      usage: { inputTokens: 7, outputTokens: 2 },
    });

    const error = await run(provider).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(StructuredOutputProviderError);
    expect(error).toMatchObject({
      cause,
      usage: { inputTokens: 7, outputTokens: 2 },
    });
  });
});
