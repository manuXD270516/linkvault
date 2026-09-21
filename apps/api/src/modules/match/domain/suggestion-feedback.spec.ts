import { describe, expect, it } from 'vitest';
import { AFTER_HASH_HEX_LENGTH, shortAfterHash } from './suggestion-feedback';

describe('shortAfterHash', () => {
  it('is a stable truncated sha256 hex of the after text', () => {
    const hash = shortAfterHash('Incluir NestJS.');
    expect(hash).toHaveLength(AFTER_HASH_HEX_LENGTH);
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(shortAfterHash('Incluir NestJS.')).toBe(hash);
    expect(shortAfterHash('Otro texto.')).not.toBe(hash);
  });
});
