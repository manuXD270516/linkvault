import { describe, expect, it } from 'vitest';
import { executionKey } from './execution-key';

// Requisito "Clave determinista independiente del texto del prompt" (specs/ai/deterministic-mock) y D4.

/**
 * Vector de referencia fijo, calculado una vez con la implementación final:
 * sha256('["classify-skills","v1","es",{"text":"TypeScript y NestJS"}]').
 * NO lo cambies para que el test pase: si cambia, han cambiado `canonicalJSON` o `executionKey` y eso invalida todos
 * los fixtures de replay y las entradas de caché (`ai:cache:v1:*`); exige una nueva versión de clave (D4, Risks).
 */
const REFERENCE_KEY =
  'e26df3e649b94d1d4d2cf651d301f56e2689e6467bf9585776aac3c10a1d3906';

describe('executionKey', () => {
  it('Vector de referencia', () => {
    const key = executionKey({
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: { text: 'TypeScript y NestJS' },
    });

    expect(key).toBe(REFERENCE_KEY);
  });

  it('Mismo input con claves en otro orden', () => {
    const base = {
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
    } as const;

    expect(
      executionKey({ ...base, input: { text: 'x', meta: { a: 1, b: 2 } } }),
    ).toBe(
      executionKey({ ...base, input: { meta: { b: 2, a: 1 }, text: 'x' } }),
    );
  });

  it('changes with task name, prompt version, output language or input', () => {
    const base = {
      taskName: 'classify-skills',
      promptVersion: 'v1',
      outputLanguage: 'es',
      input: { text: 'TypeScript y NestJS' },
    } as const;
    const variants = [
      { ...base, taskName: 'extract-job' },
      { ...base, promptVersion: 'v2' },
      { ...base, outputLanguage: 'en' },
      { ...base, input: { text: 'TypeScript y Angular' } },
    ] as const;

    const keys = new Set([base, ...variants].map((v) => executionKey(v)));

    expect(keys.size).toBe(variants.length + 1);
  });

  it('is a lowercase hexadecimal sha256', () => {
    expect(
      executionKey({
        taskName: 't',
        promptVersion: 'v1',
        outputLanguage: 'en',
        input: {},
      }),
    ).toMatch(/^[0-9a-f]{64}$/);
  });
});
