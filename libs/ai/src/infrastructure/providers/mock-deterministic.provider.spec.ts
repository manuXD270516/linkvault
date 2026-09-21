import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executionKey } from '../../application/execution-key';
import { TaskRegistry, type AnyAiTask } from '../../application/task-registry';
import { FixtureMissing, SynthUnsupported } from '../../domain/errors';
import type { CompletionRequest } from '../../domain/ports/llm-provider.port';
import type { AiTask } from '../../domain/task';
import {
  InvalidFixture,
  MockDeterministicProvider,
  MockMisuse,
  mulberry32,
  seedFromKey,
  type MockFixture,
} from './mock-deterministic.provider';

// Requisitos "Clave determinista independiente del texto del prompt", "Modo replay" y "Modo synth"
// (specs/ai/deterministic-mock) y D5 de ai-gateway-core. Fixtures temporales en os.tmpdir(), nunca en la fuente.

let fixturesDir: string;

beforeEach(async () => {
  fixturesDir = await mkdtemp(join(tmpdir(), 'linkvault-ai-mock-'));
});

afterEach(async () => {
  await rm(fixturesDir, { recursive: true, force: true });
});

async function writeFixture(
  taskName: string,
  key: string,
  fixture: MockFixture | string,
): Promise<void> {
  await mkdir(join(fixturesDir, taskName), { recursive: true });
  await writeFile(
    join(fixturesDir, taskName, `${key}.json`),
    typeof fixture === 'string' ? fixture : JSON.stringify(fixture),
    'utf8',
  );
}

function keyFor(input: unknown, promptVersion = 'v1'): string {
  return executionKey({
    taskName: 'classify-skills',
    promptVersion,
    outputLanguage: 'es',
    input,
  });
}

function request(
  key: string,
  overrides: Partial<CompletionRequest> = {},
  input?: unknown,
): CompletionRequest {
  return {
    system: 'You classify skills.',
    user: 'Text: TypeScript y NestJS',
    temperature: 0,
    responseFormat: 'json',
    trace: {
      taskName: 'classify-skills',
      promptVersion: 'v1',
      key,
      ...(input === undefined ? {} : { input }),
    },
    ...overrides,
  };
}

const fixture: MockFixture = {
  source: 'handwritten',
  text: '{"skills":[{"name":"TypeScript","category":"language"}]}',
  model: 'handwritten',
  usage: { inputTokens: 12, outputTokens: 8 },
};

describe('MockDeterministicProvider (replay)', () => {
  it('declares the mock capabilities', () => {
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    expect(provider.id).toBe('mock');
    expect(provider.capabilities).toEqual({
      jsonMode: true,
      toolUse: false,
      maxContextTokens: 1_000_000,
      external: false,
      costPer1kIn: 0,
      costPer1kOut: 0,
    });
  });

  it('Fixture existente', async () => {
    const key = keyFor({ text: 'TypeScript y NestJS' });
    await writeFixture('classify-skills', key, fixture);
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    await expect(provider.complete(request(key))).resolves.toEqual({
      text: fixture.text,
      usage: fixture.usage,
      model: fixture.model,
      latencyMs: 0,
    });
  });

  it('Fixture ausente en CI', async () => {
    const key = keyFor({ text: 'sin fixture' });
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    const error = await provider
      .complete(request(key))
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(FixtureMissing);
    expect((error as FixtureMissing).key).toBe(key);
  });

  it('Mismo input con claves en otro orden', async () => {
    const first = keyFor({
      text: 'TypeScript',
      meta: { source: 'cv', page: 1 },
    });
    const second = keyFor({
      meta: { page: 1, source: 'cv' },
      text: 'TypeScript',
    });
    expect(second).toBe(first);

    await writeFixture('classify-skills', first, fixture);
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    await expect(provider.complete(request(second))).resolves.toMatchObject({
      text: fixture.text,
    });
  });

  it('Cambio en el texto de la plantilla', async () => {
    const input = { text: 'TypeScript y NestJS' };
    // La clave no recibe la plantilla: cambiar su texto sin cambiar la versión no la altera.
    const before = keyFor(input);
    const after = keyFor(input);
    expect(after).toBe(before);
    expect(keyFor(input, 'v2')).not.toBe(before);

    await writeFixture('classify-skills', before, fixture);
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    const original = await provider.complete(request(before));
    const edited = await provider.complete(
      request(after, {
        system: 'Eres un clasificador de habilidades. (plantilla editada)',
        user: 'Texto del candidato: TypeScript y NestJS',
      }),
    );

    expect(edited).toEqual(original);
  });

  it('throws a clear programming error when the request has no trace', async () => {
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toThrow(
      MockMisuse,
    );
    await expect(provider.complete({ system: 's', user: 'u' })).rejects.toThrow(
      /trace/,
    );
  });

  it('rejects a trace whose key or task name could escape the fixtures directory', async () => {
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    await expect(
      provider.complete(request('../../etc/passwd')),
    ).rejects.toThrow(MockMisuse);
    await expect(
      provider.complete({
        system: 's',
        user: 'u',
        trace: { taskName: '../x', promptVersion: 'v1', key: keyFor({}) },
      }),
    ).rejects.toThrow(MockMisuse);
  });

  it('throws InvalidFixture for a malformed fixture instead of FixtureMissing', async () => {
    const key = keyFor({ text: 'corrupto' });
    await writeFixture('classify-skills', key, '{"text": 1');
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });

    await expect(provider.complete(request(key))).rejects.toBeInstanceOf(
      InvalidFixture,
    );
  });

  it('honours an already aborted signal', async () => {
    const key = keyFor({ text: 'TypeScript y NestJS' });
    await writeFixture('classify-skills', key, fixture);
    const provider = new MockDeterministicProvider({
      mode: 'replay',
      fixturesDir,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.complete(request(key, { signal: controller.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});

// Tarea falsa: la verificación de punta a punta con runTask y classify-skills es de 7.2.
const inputSchema = z.object({ text: z.string().min(1) });
const outputSchema = z.object({
  skills: z
    .array(
      z.object({
        name: z.string().min(1),
        category: z.enum(['language', 'framework', 'other']),
      }),
    )
    .max(60),
  confidence: z.number().min(0).max(1),
});
type FakeInput = z.infer<typeof inputSchema>;
type FakeOutput = z.infer<typeof outputSchema>;

const KNOWN: ReadonlyArray<[string, 'language' | 'framework']> = [
  ['TypeScript', 'language'],
  ['NestJS', 'framework'],
  ['Angular', 'framework'],
];

function fakeTask(withSample: boolean): AiTask<FakeInput, FakeOutput> {
  return {
    name: 'classify-skills',
    promptVersion: 'v1',
    inputSchema,
    outputSchema,
    requires: { jsonMode: true },
    temperature: 0,
    budget: { maxTokens: 256, maxAttempts: 2 },
    dataSensitivity: 'personal',
    cacheable: false,
    ...(withSample
      ? {
          sample: (input: FakeInput, rng: () => number): FakeOutput => ({
            skills: KNOWN.filter(([name]) => input.text.includes(name)).map(
              ([name, category]) => ({ name, category }),
            ),
            confidence: Math.round(rng() * 1000) / 1000,
          }),
        }
      : {}),
  };
}

function registryWith(withSample: boolean): TaskRegistry {
  return new TaskRegistry([fakeTask(withSample) as unknown as AnyAiTask]);
}

describe('MockDeterministicProvider (synth)', () => {
  it('requires a task registry in synth mode', () => {
    expect(
      () => new MockDeterministicProvider({ mode: 'synth', fixturesDir }),
    ).toThrow(MockMisuse);
  });

  it('Mismo input dos veces en modo synth', async () => {
    const input = { text: 'TypeScript, NestJS y Angular' };
    const key = keyFor(input);
    const first = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });
    const second = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });

    const a = await first.complete(request(key, {}, input));
    const b = await second.complete(request(key, {}, input));
    const c = await first.complete(request(key, {}, input));

    expect(
      Buffer.from(b.text, 'utf8').equals(Buffer.from(a.text, 'utf8')),
    ).toBe(true);
    expect(c.text).toBe(a.text);
    expect(a).toMatchObject({
      model: 'mock-synth',
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: 0,
    });
  });

  it('produces output valid against the task schema without inventing terms', async () => {
    const input = { text: 'Experiencia con TypeScript y Angular' };
    const provider = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });

    const result = await provider.complete(request(keyFor(input), {}, input));
    const output = outputSchema.parse(JSON.parse(result.text));

    expect(output.skills).toEqual([
      { name: 'TypeScript', category: 'language' },
      { name: 'Angular', category: 'framework' },
    ]);
    expect(output.confidence).toBe(
      Math.round(mulberry32(seedFromKey(keyFor(input)))() * 1000) / 1000,
    );
  });

  it('seeds the generator with the key: another key gives another draw', async () => {
    const provider = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });
    const input = { text: 'TypeScript' };
    const draws = await Promise.all(
      ['v1', 'v2', 'v3'].map(async (version) => {
        const result = await provider.complete(
          request(keyFor(input, version), {}, input),
        );
        return (JSON.parse(result.text) as FakeOutput).confidence;
      }),
    );

    expect(new Set(draws).size).toBeGreaterThan(1);
  });

  it('Tarea sin muestra', async () => {
    const input = { text: 'TypeScript' };
    const provider = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(false),
    });

    const error = await provider
      .complete(request(keyFor(input), {}, input))
      .catch((err: unknown) => err);

    expect(error).toBeInstanceOf(SynthUnsupported);
    expect((error as SynthUnsupported).taskName).toBe('classify-skills');
  });

  it('prefers an existing fixture over the sample', async () => {
    const input = { text: 'TypeScript' };
    const key = keyFor(input);
    await writeFixture('classify-skills', key, fixture);
    const provider = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });

    await expect(
      provider.complete(request(key, {}, input)),
    ).resolves.toMatchObject({ text: fixture.text, model: 'handwritten' });
  });

  it('throws a clear programming error when synth has no input or the task is not registered', async () => {
    const input = { text: 'TypeScript' };
    const key = keyFor(input);
    const provider = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: registryWith(true),
    });
    const empty = new MockDeterministicProvider({
      mode: 'synth',
      fixturesDir,
      tasks: new TaskRegistry(),
    });

    await expect(provider.complete(request(key))).rejects.toThrow(
      /trace\.input/,
    );
    await expect(empty.complete(request(key, {}, input))).rejects.toThrow(
      MockMisuse,
    );
  });
});

describe('mulberry32', () => {
  it('is deterministic per seed and stays in [0, 1)', () => {
    const a = mulberry32(seedFromKey('deadbeef'.padEnd(64, '0')));
    const b = mulberry32(0xdeadbeef);
    const valuesA = Array.from({ length: 1000 }, () => a());
    const valuesB = Array.from({ length: 1000 }, () => b());

    expect(valuesA).toEqual(valuesB);
    expect(valuesA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(valuesA).size).toBeGreaterThan(990);
  });
});
