import { describe, expect, it } from 'vitest';
import {
  MAX_PUBLIC_SLUG_ATTEMPTS,
  mayPublish,
  PublicSlugExhausted,
} from './public-share';
import { isValidPublicSlug, PUBLIC_SLUG_LENGTH } from './public-slug';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';

describe('mayPublish', () => {
  it.each([
    ['quien compartió el link', ANA, ANA, 'member' as const, true],
    ['el owner con un link ajeno', ANA, BETO, 'owner' as const, true],
    ['otro miembro', CARLA, BETO, 'member' as const, false],
    ['quien compartió, siendo owner', ANA, ANA, 'owner' as const, true],
  ])('%s', (_case, requesterId, sharedBy, role, expected) => {
    expect(mayPublish(requesterId, sharedBy, role)).toBe(expected);
  });
});

describe('PublicSlugExhausted', () => {
  it('no es un error de dominio: no lleva código de la API', () => {
    const error = new PublicSlugExhausted();

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toHaveProperty('code');
    expect(error.message).toContain(String(MAX_PUBLIC_SLUG_ATTEMPTS));
  });

  it('se rinde a los cinco intentos', () => {
    expect(MAX_PUBLIC_SLUG_ATTEMPTS).toBe(5);
  });
});

describe('el formato del slug que usa el dominio', () => {
  it('es el de `@linkvault/shared`, sin una segunda copia', () => {
    expect(PUBLIC_SLUG_LENGTH).toBe(12);
    expect(isValidPublicSlug('k7m2p9r4t6vw')).toBe(true);
    expect(isValidPublicSlug('K7M2P9R4T6VW')).toBe(false);
  });
});
