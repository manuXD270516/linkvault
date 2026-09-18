import { describe, expect, it } from 'vitest';
import { normalizeUrl } from '../url';
import { canonicalize } from './registry';

/** Canonicalización de una URL real tal y como la escribiría una persona: primero se normaliza, como en producción. */
function canonicalizeRaw(raw: string) {
  const normalized = normalizeUrl(raw);
  expect(normalized).not.toBeNull();
  return canonicalize(normalized?.normalizedUrl ?? '');
}

describe('computrabajoCanonicalizer', () => {
  it('Computrabajo con slug variable', () => {
    const fromTheChat =
      'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-en-la-paz-a1b2c3d4e5f60718';
    const fromTheSearch =
      'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-programador-backend-senior-en-nuestra-empresa-a1b2c3d4e5f60718';

    expect(canonicalizeRaw(fromTheChat)).toEqual({
      platform: 'computrabajo',
      externalJobId: 'a1b2c3d4e5f60718',
    });
    expect(canonicalizeRaw(fromTheSearch)).toEqual(
      canonicalizeRaw(fromTheChat),
    );
  });

  // Tabla de URLs reales anonimizadas: identificadores y slugs cambiados, forma intacta.
  it.each([
    [
      'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend-en-la-paz-a1b2c3d4e5f60718',
      'a1b2c3d4e5f60718',
    ],
    [
      'https://www.computrabajo.com.mx/ofertas-de-trabajo/oferta-de-trabajo-de-auxiliar-administrativo-en-cuauhtemoc-b2c3d4e5f6071829',
      'b2c3d4e5f6071829',
    ],
    [
      'https://co.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-de-datos-en-bogota-c3d4e5f607182930.html',
      'c3d4e5f607182930',
    ],
    [
      'https://pe.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-cajero-en-lima-D4E5F60718293041',
      'd4e5f60718293041',
    ],
    [
      'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-disenador-en-santa-cruz-e5f6071829304152?utm_source=wa&BsqOfr=1',
      'e5f6071829304152',
    ],
  ])('reads the offer id of %j', (raw, externalJobId) => {
    expect(canonicalizeRaw(raw)).toEqual({
      platform: 'computrabajo',
      externalJobId,
    });
  });

  it.each([
    // Listados y páginas de empresa no identifican una oferta concreta.
    ['https://bo.computrabajo.com/trabajo-de-desarrollador-en-la-paz'],
    ['https://bo.computrabajo.com/empresas/acme'],
    // Una oferta sin identificador al final del segmento degrada a dedupe por URL.
    [
      'https://bo.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-desarrollador-backend',
    ],
  ])('leaves %j as generic', (raw) => {
    expect(canonicalizeRaw(raw)).toEqual({ platform: 'generic' });
  });
});
