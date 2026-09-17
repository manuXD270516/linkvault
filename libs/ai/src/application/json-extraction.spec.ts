import { describe, expect, it } from 'vitest';
import { extractJson } from './json-extraction';

// D3 de ai-gateway-core; base del escenario "JSON dentro de un bloque de código" (task-execution).

describe('extractJson', () => {
  it('parses clean JSON', () => {
    expect(
      extractJson('{"skills":[{"name":"Go","category":"language"}]}'),
    ).toEqual({
      ok: true,
      value: { skills: [{ name: 'Go', category: 'language' }] },
    });
  });

  it('parses clean JSON with surrounding whitespace and a top-level array', () => {
    expect(extractJson('\n  [1, 2, 3]\n')).toEqual({
      ok: true,
      value: [1, 2, 3],
    });
  });

  it('JSON dentro de un bloque de código con texto alrededor', () => {
    const text = [
      'Aquí tienes la clasificación:',
      '```json',
      '{ "skills": [{ "name": "NestJS", "category": "framework" }] }',
      '```',
      'Espero que sirva.',
    ].join('\n');

    expect(extractJson(text)).toEqual({
      ok: true,
      value: { skills: [{ name: 'NestJS', category: 'framework' }] },
    });
  });

  it('accepts a code block without language tag', () => {
    expect(extractJson('Resultado:\n```\n{"a":1}\n```')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('accepts an inline code block', () => {
    expect(extractJson('Salida: ```{"a":1}```')).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });

  it('extracts the first balanced object from prose without a code block', () => {
    expect(
      extractJson('Claro. {"a": {"b": [1, 2]}} y nada más {"c": 3}'),
    ).toEqual({
      ok: true,
      value: { a: { b: [1, 2] } },
    });
  });

  it('respects braces and brackets inside strings with escapes', () => {
    const json = String.raw`{"text":"a } b ] c { \"quoted } \" \\","n":1}`;

    expect(extractJson(`Respuesta: ${json} fin`)).toEqual({
      ok: true,
      value: { text: 'a } b ] c { "quoted } " \\', n: 1 },
    });
  });

  it('skips a non-JSON brace fragment and keeps looking', () => {
    expect(extractJson('Usa {placeholder} así: {"ok": true}')).toEqual({
      ok: true,
      value: { ok: true },
    });
  });

  it.each([
    ['plain prose', 'Lo siento, no puedo clasificar ese texto.'],
    ['empty text', ''],
    ['unbalanced object', '{"a": 1'],
    ['bare scalar', '42'],
    ['code block without JSON', '```\nno json here\n```'],
  ])('reports no JSON for %s', (_label, text) => {
    expect(extractJson(text)).toEqual({ ok: false, reason: 'no_json' });
  });
});
