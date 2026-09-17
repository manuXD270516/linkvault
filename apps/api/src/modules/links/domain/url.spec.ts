import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { normalizeUrl, toDisplayUrl, urlHashOf } from './url';

/** URL normalizada de una entrada que se sabe válida, para leer las tablas sin ruido. */
function normalized(raw: string): string {
  const result = normalizeUrl(raw);
  expect(result).not.toBeNull();
  return result?.normalizedUrl ?? '';
}

describe('normalizeUrl', () => {
  it('URL normalizada', () => {
    const raw = 'HTTP://WWW.Example.com/Jobs/123/?utm_source=wa&ref=x#top';

    expect(normalizeUrl(raw)?.normalizedUrl).toBe('https://example.com/Jobs/123');
    expect(toDisplayUrl(raw)).toBe(raw);
  });

  it('Esquema no soportado', () => {
    expect(normalizeUrl('ftp://example.com/job')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it.each([
    // Esquema y host en minúsculas, `http` pasa a `https`.
    ['HTTPS://EXAMPLE.COM/Jobs', 'https://example.com/Jobs'],
    ['http://example.com/jobs/1', 'https://example.com/jobs/1'],
    // `www.` fuera, cualquier otro subdominio se conserva.
    ['https://www.example.com/jobs/1', 'https://example.com/jobs/1'],
    ['https://jobs.example.com/1', 'https://jobs.example.com/1'],
    // Fragmento fuera.
    ['https://example.com/jobs/1#apply', 'https://example.com/jobs/1'],
    // Barra final fuera salvo en la raíz.
    ['https://example.com/jobs/1/', 'https://example.com/jobs/1'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com', 'https://example.com/'],
    // Parámetros de campaña fuera, los de verdad se conservan.
    [
      'https://example.com/jobs?utm_source=wa&utm_medium=chat&jk=abc',
      'https://example.com/jobs?jk=abc',
    ],
    [
      'https://example.com/jobs?gclid=1&fbclid=2&mc_cid=3&mc_eid=4&igshid=5&ref=6&trk=7&trkCampaign=8',
      'https://example.com/jobs',
    ],
    ['https://example.com/jobs?UTM_SOURCE=wa', 'https://example.com/jobs'],
    // Resto de parámetros ordenados.
    ['https://example.com/jobs?b=2&a=1', 'https://example.com/jobs?a=1&b=2'],
    ['https://example.com/jobs?a=2&a=1', 'https://example.com/jobs?a=1&a=2'],
    // Espacios exteriores y credenciales fuera.
    ['  https://example.com/jobs/1  ', 'https://example.com/jobs/1'],
    ['https://ana:secreto@example.com/jobs/1', 'https://example.com/jobs/1'],
  ])('normalizes %j to %j', (raw, expected) => {
    expect(normalized(raw)).toBe(expected);
  });

  it.each([
    ['no-es-una-url'],
    [''],
    ['   '],
    ['http://'],
    ['mailto:ana@example.com'],
    ['//example.com/jobs'],
  ])('rejects %j as unrecognized', (raw) => {
    expect(normalizeUrl(raw)).toBeNull();
  });
});

describe('urlHash', () => {
  it('is stable no matter the order of the query parameters', () => {
    const one = normalizeUrl('https://example.com/jobs?b=2&a=1&utm_source=wa');
    const other = normalizeUrl('https://www.example.com/jobs/?a=1&b=2#top');

    expect(one?.urlHash).toBe(other?.urlHash);
  });

  it('differs for different normalized urls', () => {
    expect(normalizeUrl('https://example.com/jobs/1')?.urlHash).not.toBe(
      normalizeUrl('https://example.com/jobs/2')?.urlHash,
    );
  });

  it('is the sha256 of the normalized url in hex', () => {
    const result = normalizeUrl('https://example.com/jobs/1');

    expect(result?.urlHash).toBe(
      createHash('sha256').update('https://example.com/jobs/1').digest('hex'),
    );
    expect(result?.urlHash).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHashOf('https://example.com/jobs/1')).toBe(result?.urlHash);
  });
});

describe('toDisplayUrl', () => {
  it('keeps the url as the person wrote it, without outer spaces', () => {
    expect(toDisplayUrl('  HTTP://WWW.Example.com/Jobs/123/?ref=x  ')).toBe(
      'HTTP://WWW.Example.com/Jobs/123/?ref=x',
    );
  });
});
