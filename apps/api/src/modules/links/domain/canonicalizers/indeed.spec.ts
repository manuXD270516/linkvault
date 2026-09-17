import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('indeedCanonicalizer', () => {
  // Tabla de URLs reales anonimizadas: identificadores cambiados, forma intacta.
  it.each([
    ['https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b', '1a2b3c4d5e6f7a8b'],
    ['https://bo.indeed.com/viewjob?jk=2b3c4d5e6f7a8b9c', '2b3c4d5e6f7a8b9c'],
    ['https://www.indeed.com.mx/viewjob?jk=3c4d5e6f7a8b9c0d', '3c4d5e6f7a8b9c0d'],
    ['https://m.indeed.com/viewjob?jk=4d5e6f7a8b9c0d1e', '4d5e6f7a8b9c0d1e'],
    [
      'https://www.indeed.com/viewjob?jk=5e6f7a8b9c0d1e2f&from=serp&vjs=3',
      '5e6f7a8b9c0d1e2f',
    ],
    [
      'https://www.indeed.com/jobs?q=backend&l=La+Paz&vjk=6f7a8b9c0d1e2f3a',
      '6f7a8b9c0d1e2f3a',
    ],
    [
      'https://www.indeed.com/rc/clk?jk=7a8b9c0d1e2f3a4b&fccid=abc&vjs=3',
      '7a8b9c0d1e2f3a4b',
    ],
    [
      'https://www.indeed.com/pagead/clk?mo=r&ad=xyz&jk=8b9c0d1e2f3a4b5c',
      '8b9c0d1e2f3a4b5c',
    ],
  ])('reads the job key of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'indeed', externalJobId });
  });

  it('reads the same job key from the search panel and from the job page', () => {
    expect(
      canonicalizeRaw('https://www.indeed.com/jobs?q=backend&vjk=1a2b3c4d5e6f7a8b'),
    ).toEqual(canonicalizeRaw('https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b'));
  });

  it.each([
    // Búsquedas sin vacante abierta y páginas de empresa no identifican una oferta.
    ['https://www.indeed.com/jobs?q=backend&l=La+Paz'],
    ['https://www.indeed.com/cmp/Acme'],
    // Un dominio que solo contiene el nombre no es Indeed.
    ['https://indeed.com.evil.example/viewjob?jk=1a2b3c4d5e6f7a8b'],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
