import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('canonicalize', () => {
  it('Plataforma desconocida', () => {
    const result = canonicalizeRaw('https://empresa.example/careers/backend');

    expect(result).toEqual({ platform: 'generic' });
    expect(result.externalJobId).toBeUndefined();
  });

  it.each([
    ['https://www.linkedin.com/jobs/view/3811111111/', 'linkedin'],
    ['https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b', 'indeed'],
    [
      'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718',
      'computrabajo',
    ],
    [
      'https://www.trabajopolis.bo/trabajo/1238122/arquitecto-de-soluciones',
      'trabajopolis',
    ],
    [
      'https://www.getonbrd.com/jobs/programming/full-stack-developer-senior-witi-remote-afcb',
      'getonboard',
    ],
    ['https://empresa.example/careers/backend', 'generic'],
  ])('sends %j to the %s canonicalizer', (raw, platform) => {
    expect(canonicalizeRaw(raw).platform).toBe(platform);
  });

  it('gives the same result for the same normalized url', () => {
    expect(canonicalizeRaw('https://empresa.example/careers/backend/')).toEqual(
      canonicalizeRaw('HTTP://WWW.Empresa.example/careers/backend?utm_source=wa'),
    );
  });

  it('falls back to generic when the url cannot be parsed', () => {
    expect(canonicalize('no-es-una-url')).toEqual({ platform: 'generic' });
  });
});
