import { describe, expect, it } from 'vitest';
import {
  isValidPublicSlug,
  PUBLIC_SLUG_ALPHABET,
  PUBLIC_SLUG_LENGTH,
  publicSlugSchema,
} from './public-slug';

describe('publicSlugSchema', () => {
  it.each([
    ['slug válido', 'k7m2p9r4t6vw', true],
    ['con mayúsculas', 'K7M2P9R4T6VW', false],
    ['con un 0', 'k7m2p9r4t60w', false],
    ['con una l', 'k7m2p9r4t6lw', false],
    ['con una o', 'k7m2p9r4t6ow', false],
    ['con una i', 'k7m2p9r4t6iw', false],
    ['con una u', 'k7m2p9r4t6uw', false],
    ['de 11 caracteres', 'k7m2p9r4t6v', false],
    ['de 13 caracteres', 'k7m2p9r4t6vwx', false],
    ['vacío', '', false],
    ['con una barra', 'k7m2p9r4t6v/', false],
    ['con un punto', '../../etc/pas', false],
  ])('juzga un slug %s', (_name, slug, expected) => {
    expect(isValidPublicSlug(slug)).toBe(expected);
    expect(publicSlugSchema.safeParse(slug).success).toBe(expected);
  });

  it('no normaliza la caja ni los espacios', () => {
    expect(publicSlugSchema.safeParse(' k7m2p9r4t6vw ').success).toBe(false);
  });

  it('declara un alfabeto de 30 símbolos sin los ambiguos', () => {
    expect(PUBLIC_SLUG_ALPHABET).toHaveLength(30);
    expect(new Set(PUBLIC_SLUG_ALPHABET).size).toBe(30);
    for (const ambiguous of ['0', '1', 'i', 'l', 'o', 'u']) {
      expect(PUBLIC_SLUG_ALPHABET).not.toContain(ambiguous);
    }
    expect(PUBLIC_SLUG_LENGTH).toBe(12);
  });
});
