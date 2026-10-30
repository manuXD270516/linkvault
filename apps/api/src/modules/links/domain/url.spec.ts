import { createHash } from 'node:crypto';
import { lookup } from 'node:dns';
import { lookup as lookupPromise } from 'node:dns/promises';
import { describe, expect, it, vi } from 'vitest';
import { normalizeUrl, toDisplayUrl, urlHashOf } from './url';

// Ningún camino de guardado resuelve nombres: la decisión de adónde se conecta es del worker (D6 de
// enrichment-egress-guard). Los dos módulos de DNS se sustituyen por espías y el test comprueba que no se llaman.
vi.mock('node:dns', () => ({ lookup: vi.fn(), resolve: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: vi.fn(), resolve: vi.fn() }));

/** URL normalizada de una entrada que se sabe válida, para leer las tablas sin ruido. */
function normalized(raw: string): string {
  const result = normalizeUrl(raw);
  expect(result).not.toBeNull();
  return result?.normalizedUrl ?? '';
}

describe('normalizeUrl', () => {
  it('URL normalizada', () => {
    const raw = 'HTTP://WWW.Example.com/Jobs/123/?utm_source=wa&ref=x#top';

    expect(normalizeUrl(raw)?.normalizedUrl).toBe(
      'https://example.com/Jobs/123',
    );
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

describe('normalizeUrl: destinos que no son de Internet pública', () => {
  it('rejects a literal private or loopback host as unrecognized', () => {
    for (const raw of [
      'http://127.0.0.1/jobs/1',
      'https://10.0.0.5/jobs/1',
      'http://192.168.1.10:8080/jobs/1',
      'http://169.254.169.254/latest/meta-data',
      'http://100.64.0.1/jobs/1',
      'http://[::1]/jobs/1',
      'http://[fd00::1]/jobs/1',
      'http://[::ffff:7f00:1]/jobs/1',
      // Notaciones alternativas que el analizador de URLs normaliza.
      'http://2130706433/jobs/1',
      'http://0x7f.1/jobs/1',
      'http://0177.0.0.1/jobs/1',
    ]) {
      expect(normalizeUrl(raw), raw).toBeNull();
    }
  });

  it('rejects a dotless host as unrecognized', () => {
    for (const raw of [
      'http://intranet/jobs/1',
      'https://servicio/jobs/1',
      'http://intranet./jobs/1',
      'http://localhost/jobs/1',
      'http://app.localhost/jobs/1',
    ]) {
      expect(normalizeUrl(raw), raw).toBeNull();
    }
  });

  it('accepts a dotted name with a non-web port', () => {
    // El puerto no se juzga al guardar (B2): el worker marca el link y la persona conserva el suyo.
    expect(normalizeUrl('https://bolsa.example:8443/jobs/1')).not.toBeNull();
    expect(normalizeUrl('http://bolsa.example:8080/jobs/1')).not.toBeNull();
  });

  it('accepts a public IP literal with a non-web port', () => {
    expect(normalizeUrl('http://93.184.216.34:8080/jobs/1')).not.toBeNull();
    expect(
      normalizeUrl('https://[2606:4700:4700::1111]:8443/jobs/1'),
    ).not.toBeNull();
  });

  it('does not resolve names when saving', () => {
    normalizeUrl('https://bolsa.example/jobs/1');
    normalizeUrl('http://intranet/jobs/1');
    normalizeUrl('http://127.0.0.1/jobs/1');
    expect(vi.mocked(lookup)).not.toHaveBeenCalled();
    expect(vi.mocked(lookupPromise)).not.toHaveBeenCalled();
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
