import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('trabajopolisCanonicalizer', () => {
  it('reads the offer id no matter the search that led to it or the slug', () => {
    const fromTheSearch =
      'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones?search_id=1789686903.0046';
    const shared = 'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones';
    const withAnotherSlug =
      'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones-senior';

    expect(canonicalizeRaw(fromTheSearch)).toEqual({
      platform: 'trabajopolis',
      externalJobId: '1238122',
    });
    expect(canonicalizeRaw(shared)).toEqual(canonicalizeRaw(fromTheSearch));
    expect(canonicalizeRaw(withAnotherSlug)).toEqual(
      canonicalizeRaw(fromTheSearch),
    );
  });

  // Tabla de URLs reales anonimizadas: identificadores y slugs cambiados, forma intacta.
  it.each([
    [
      'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones?search_id=1789686903.0046',
      '1238122',
    ],
    [
      'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones',
      '1238122',
    ],
    ['https://trabajopolis.bo/trabajo/1240577/desarrollador-backend', '1240577'],
    [
      'https://www.trabajopolis.bo/trabajo/1240577/desarrollador-backend-senior?search_id=1789686903.0046&utm_source=wa',
      '1240577',
    ],
    ['https://www.trabajopolis.bo/trabajo/1251003', '1251003'],
  ])('reads the offer id of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({
      platform: 'trabajopolis',
      externalJobId,
    });
  });

  it('gives different keys to two different offers', () => {
    expect(
      canonicalizeRaw('https://www.trabajopolis.bo/trabajo/1238122/arquitecto'),
    ).not.toEqual(
      canonicalizeRaw('https://www.trabajopolis.bo/trabajo/1240577/arquitecto'),
    );
  });

  it.each([
    // Listados y páginas de empresa no identifican una oferta concreta.
    ['https://www.trabajopolis.bo/trabajos/'],
    ['https://www.trabajopolis.bo/empresa/acme'],
    // Sin número no hay identificador.
    ['https://www.trabajopolis.bo/trabajo/arquitecto-de-soluciones'],
    // Un dominio que solo contiene el nombre no es Trabajopolis.
    ['https://trabajopolis.bo.evil.example/trabajo/1238122/arquitecto'],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
