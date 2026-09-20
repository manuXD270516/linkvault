import { PUBLIC_SLUG_LENGTH, isValidPublicSlug } from '@linkvault/shared';
import { importSlug } from './import-slug';

/** Formas que llegan por `?import=`: un slug válido y todo lo que no lo es. */
const CASES = [
  'k3m9qrtv2xyz',
  'K3M9QRTV2XYZ',
  'k3m9qrtv2xy0',
  'k3m9qrtv2xyl',
  'k3m9qrtv2xyo',
  'k3m9qrtv2xyu',
  'k3m9qrtv2xy',
  'k3m9qrtv2xyzz',
  '',
  '../otra-cosa',
  'k3m9qrtv2xy/',
  ' k3m9qrtv2xyz',
];

describe('importSlug', () => {
  it('only accepts a well formed public slug', () => {
    expect(importSlug('k3m9qrtv2xyz')).toBe('k3m9qrtv2xyz');
    for (const value of CASES.slice(1)) {
      expect.soft(importSlug(value), `"${value}" should be ignored`).toBeNull();
    }
    expect(importSlug(null)).toBeNull();
    expect(importSlug(undefined)).toBeNull();
  });

  it('judges exactly like isValidPublicSlug', () => {
    // El patrón se repite en `core/` para no meter zod en el bundle inicial; este test es lo que impide que se separen.
    for (const value of CASES) {
      expect.soft(importSlug(value) !== null, `"${value}"`).toBe(isValidPublicSlug(value));
    }
    expect(PUBLIC_SLUG_LENGTH).toBe(12);
  });
});
