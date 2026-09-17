import { describe, expect, it } from 'vitest';
import { canonicalJSON } from './canonical-json';

// D4 de ai-gateway-core y requisito "Clave determinista independiente del texto del prompt" (deterministic-mock).

describe('canonicalJSON', () => {
  it('sorts object keys recursively, including objects nested in arrays', () => {
    const a = { b: 1, a: { d: [{ z: 1, y: 2 }], c: 'x' } };
    const b = { a: { c: 'x', d: [{ y: 2, z: 1 }] }, b: 1 };

    expect(canonicalJSON(a)).toBe('{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}');
    expect(canonicalJSON(b)).toBe(canonicalJSON(a));
  });

  it('sorts keys by UTF-16 code unit, not by locale', () => {
    expect(canonicalJSON({ b: 1, B: 2, á: 3, a: 4 })).toBe(
      '{"B":2,"a":4,"b":1,"á":3}',
    );
  });

  it('omits undefined values in objects', () => {
    expect(canonicalJSON({ a: undefined, b: 1, c: { d: undefined } })).toBe(
      '{"b":1,"c":{}}',
    );
    expect(canonicalJSON({ b: 1 })).toBe(
      canonicalJSON({ b: 1, missing: undefined }),
    );
  });

  it('serializes -0 as 0', () => {
    expect(canonicalJSON(-0)).toBe('0');
    expect(canonicalJSON({ n: -0, list: [-0] })).toBe('{"list":[0],"n":0}');
    expect(canonicalJSON({ n: -0 })).toBe(canonicalJSON({ n: 0 }));
  });

  it('keeps array order', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalJSON(['b', 'a'])).not.toBe(canonicalJSON(['a', 'b']));
  });

  it('writes no whitespace and escapes strings like JSON', () => {
    expect(canonicalJSON({ text: 'a "b"\n c', list: [1, true, null] })).toBe(
      '{"list":[1,true,null],"text":"a \\"b\\"\\n c"}',
    );
  });

  it('follows JSON.stringify for undefined in arrays and toJSON', () => {
    expect(canonicalJSON([undefined, 1])).toBe('[null,1]');
    expect(canonicalJSON({ at: new Date('2026-01-02T03:04:05.000Z') })).toBe(
      '{"at":"2026-01-02T03:04:05.000Z"}',
    );
  });

  it('rejects values that JSON cannot represent at the top level', () => {
    expect(() => canonicalJSON(undefined)).toThrow(TypeError);
    expect(() => canonicalJSON({ n: 1n })).toThrow(TypeError);
  });
});
