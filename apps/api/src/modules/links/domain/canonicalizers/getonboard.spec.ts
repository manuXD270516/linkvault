import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('getonboardCanonicalizer', () => {
  it('reads the slug of the offer with and without its category', () => {
    const fromTheSearch =
      'https://www.getonbrd.com/jobs/programming/full-stack-developer-senior-witi-remote-afcb';
    const withoutCategory =
      'https://www.getonbrd.com/jobs/full-stack-developer-senior-witi-remote-afcb';

    expect(canonicalizeRaw(fromTheSearch)).toEqual({
      platform: 'getonboard',
      externalJobId: 'full-stack-developer-senior-witi-remote-afcb',
    });
    expect(canonicalizeRaw(withoutCategory)).toEqual(
      canonicalizeRaw(fromTheSearch),
    );
  });

  // Tabla de URLs reales anonimizadas: slugs y empresas cambiados, forma intacta.
  it.each([
    [
      'https://www.getonbrd.com/jobs/programming/full-stack-developer-senior-witi-remote-afcb',
      'full-stack-developer-senior-witi-remote-afcb',
    ],
    [
      'https://getonbrd.com/jobs/programming/full-stack-developer-senior-witi-remote-afcb/',
      'full-stack-developer-senior-witi-remote-afcb',
    ],
    [
      'https://www.getonbrd.com/jobs/programming/backend-developer-acme-santiago-2b3c?utm_source=wa',
      'backend-developer-acme-santiago-2b3c',
    ],
    [
      'https://www.getonbrd.com/jobs/design/product-designer-acme-remote-3c4d',
      'product-designer-acme-remote-3c4d',
    ],
    [
      'https://www.getonbrd.com/jobs/data-science/data-engineer-acme-remote-4d5e',
      'data-engineer-acme-remote-4d5e',
    ],
    [
      'https://www.getonbrd.com/jobs/qa-engineer-acme-remote-5e6f',
      'qa-engineer-acme-remote-5e6f',
    ],
  ])('reads the offer slug of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({
      platform: 'getonboard',
      externalJobId,
    });
  });

  it('gives the same key to the same offer listed under another category', () => {
    expect(
      canonicalizeRaw(
        'https://www.getonbrd.com/jobs/programming/backend-developer-acme-santiago-2b3c',
      ),
    ).toEqual(
      canonicalizeRaw(
        'https://www.getonbrd.com/jobs/devops/backend-developer-acme-santiago-2b3c',
      ),
    );
  });

  it.each([
    // Listados por categoría: comparten forma con `/jobs/<slug>` y no son una oferta.
    ['https://www.getonbrd.com/jobs/programming'],
    ['https://www.getonbrd.com/jobs/data-science'],
    ['https://www.getonbrd.com/jobs'],
    // Subpáginas de la oferta: no se pueden justificar con los enlaces conocidos, así que degradan a dedupe por URL.
    [
      'https://www.getonbrd.com/jobs/programming/backend-developer-acme-santiago-2b3c/apply',
    ],
    // Perfiles de empresa y un dominio que solo contiene el nombre.
    ['https://www.getonbrd.com/companies/acme'],
    ['https://getonbrd.com.evil.example/jobs/programming/backend-developer-acme-2b3c'],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
