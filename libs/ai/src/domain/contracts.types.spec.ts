import { describe, expect, expectTypeOf, it } from 'vitest';
import type { AiResult } from './ai-result';
import type { CompletionRequest } from './ports/llm-provider.port';
import type { RunContext } from './run-context';

// Test de tipos de la tarea 1.2 (D2, D4). Lo comprueba `pnpm nx typecheck ai` (incluye tsconfig.spec.json):
// si una directiva `@ts-expect-error` deja de ser necesaria, el typecheck falla.

interface Output {
  skills: string[];
}

describe('domain contracts (types)', () => {
  it('compiles a degraded result without output', () => {
    const degraded: AiResult<Output> = {
      status: 'degraded',
      reason: 'no_providers',
    };

    expectTypeOf(degraded).toExtend<AiResult<Output>>();
    expect(degraded.status).toBe('degraded');
  });

  it('requires output, provider, model, prompt version and cached flag in a success result', () => {
    // @ts-expect-error un success sin output no compila
    const success: AiResult<Output> = {
      status: 'success',
      providerId: 'mock',
      model: 'mock-1',
      promptVersion: 'v1',
      cached: false,
    };

    expect(success.status).toBe('success');
  });

  it('rejects a RunContext without aiConsent', () => {
    // @ts-expect-error aiConsent es obligatorio y no tiene valor por defecto (D2)
    const ctx: RunContext = { userId: 'user-1' };

    expect(ctx.userId).toBe('user-1');
  });

  it('accepts a RunContext with only aiConsent', () => {
    const ctx: RunContext = { aiConsent: { externalProviders: false } };

    expectTypeOf(ctx.outputLanguage).toEqualTypeOf<'es' | 'en' | undefined>();
    expect(ctx.aiConsent.externalProviders).toBe(false);
  });

  it('carries an optional trace in CompletionRequest', () => {
    const req: CompletionRequest = {
      system: 's',
      user: 'u',
      trace: { taskName: 'classify-skills', promptVersion: 'v1', key: 'abc' },
    };

    expectTypeOf<CompletionRequest['trace']>().toEqualTypeOf<
      { taskName: string; promptVersion: string; key: string } | undefined
    >();
    expect(req.trace?.key).toBe('abc');
  });
});
