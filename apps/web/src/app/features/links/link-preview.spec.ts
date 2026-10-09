import type { JobSalary, ResolvedPreviewSources } from '@linkvault/shared';
import {
  daysSince,
  fieldOrigin,
  formatSalary,
  latestPaste,
  linkLabel,
  modalityLabel,
  originText,
  platformName,
  seniorityLabel,
} from './link-preview';

const salary = (parts: Partial<JobSalary>): JobSalary => ({
  min: null,
  max: null,
  currency: null,
  period: null,
  ...parts,
});

// La tabla de `linkLabel` vive con la función, en `libs/shared/src/links/link-label.spec.ts` (D10 de
// public-preview-share). Aquí solo se comprueba que el reexporte sigue en pie: quien la importa de `./link-preview` no
// se enteró del movimiento.
describe('linkLabel', () => {
  it('sigue disponible desde donde estaba', () => {
    expect(linkLabel('https://ejemplo.test/ofertas/analista.html')).toBe(
      'analista',
    );
  });
});

describe('platformName', () => {
  it('names the platforms with their own brand', () => {
    expect(platformName('linkedin')).toBe('LinkedIn');
    expect(platformName('getonboard')).toBe('Get on Board');
    expect(platformName('remoteok')).toBe('RemoteOK');
  });

  it('calls anything else another site', () => {
    expect(platformName('generic')).toBe('Otra web');
  });
});

describe('modalityLabel y seniorityLabel', () => {
  it.each([
    ['remote', 'Remoto'],
    ['hybrid', 'Híbrido'],
    ['onsite', 'Presencial'],
  ] as const)('says %s in words', (modality, expected) => {
    expect(modalityLabel(modality)).toBe(expected);
  });

  it.each([
    ['intern', 'Prácticas'],
    ['junior', 'Junior'],
    ['mid', 'Intermedio'],
    ['senior', 'Senior'],
    ['lead', 'Líder'],
  ] as const)('says %s in words', (seniority, expected) => {
    expect(seniorityLabel(seniority)).toBe(expected);
  });

  /** Lo que la página no dijo no ocupa sitio en la tarjeta: `unknown` y la ausencia se tratan igual. */
  it('says nothing about what the page did not say', () => {
    expect(modalityLabel('unknown')).toBeNull();
    expect(modalityLabel(undefined)).toBeNull();
    expect(seniorityLabel('unknown')).toBeNull();
    expect(seniorityLabel(undefined)).toBeNull();
  });
});

describe('formatSalary', () => {
  /** `es-ES` fija el separador de miles del test: el formato del navegador no lo decide esta función. */
  const es = (value: JobSalary | null | undefined): string | null => formatSalary(value, 'es-ES');

  it('says the range with its currency and its period', () => {
    expect(es(salary({ min: 8000, max: 12000, currency: 'BOB', period: 'month' }))).toBe(
      '8.000 – 12.000 BOB al mes',
    );
  });

  it.each([
    [salary({ min: 8000, currency: 'USD', period: 'year' }), 'Desde 8.000 USD al año'],
    [salary({ max: 120, currency: 'USD', period: 'hour' }), 'Hasta 120 USD por hora'],
    [salary({ min: 8000, max: 12000 }), '8.000 – 12.000'],
    [salary({ min: 8000, period: 'month' }), 'Desde 8.000 al mes'],
  ])('says a half-published salary as far as it goes', (value, expected) => {
    expect(es(value)).toBe(expected);
  });

  /** "BOB al mes" no es un salario: sin cifras no hay nada que enseñar. */
  it('says nothing when there is no amount', () => {
    expect(es(salary({ currency: 'BOB', period: 'month' }))).toBeNull();
    expect(es(null)).toBeNull();
    expect(es(undefined)).toBeNull();
  });
});

describe('daysSince', () => {
  const now = new Date('2026-09-18T12:00:00.000Z');

  it.each([
    ['2026-09-18', 0],
    ['2026-09-17', 1],
    ['2026-09-08', 10],
  ])('counts the days since %s', (date, expected) => {
    expect(daysSince(date, now)).toBe(expected);
  });

  /** Una oferta publicada "dentro de dos días" no existe: la fecha rara se cuenta como hoy. */
  it('never counts backwards', () => {
    expect(daysSince('2026-09-20', now)).toBe(0);
  });

  it('says nothing about a date that is not there or is not a date', () => {
    expect(daysSince(null, now)).toBeNull();
    expect(daysSince(undefined, now)).toBeNull();
    expect(daysSince('ayer', now)).toBeNull();
  });
});

describe('fieldOrigin', () => {
  const at = '2026-09-18T10:00:00.000Z';

  it('tells what was read from the page from what the AI guessed', () => {
    expect(fieldOrigin({ value: 'Acme', source: 'auto', extractor: 'json-ld', at })).toEqual({
      kind: 'page',
      extractor: 'json-ld',
    });
    expect(fieldOrigin({ value: 'Acme', source: 'auto', extractor: 'ai:extract-job', at })).toEqual({
      kind: 'ai',
    });
  });

  it('carries the name of whoever wrote it by hand', () => {
    expect(
      fieldOrigin({
        value: 'Ingeniera de datos',
        source: 'manual',
        by: { userId: 'u1', displayName: 'Ana' },
        at,
      }),
    ).toEqual({ kind: 'manual', by: { userId: 'u1', displayName: 'Ana' } });
  });

  it('says nothing about a field nobody wrote', () => {
    expect(fieldOrigin(undefined)).toBeNull();
  });
});

describe('latestPaste', () => {
  const ana = { userId: 'u1', displayName: 'Ana' };
  const beto = { userId: 'u2', displayName: 'Beto' };
  const pastedAt = '2026-09-18T12:00:00.000Z';
  const later = '2026-09-18T13:00:00.000Z';
  const pasted = <const T>(value: T, by: typeof ana | null = ana, at = pastedAt) =>
    ({ value, source: 'pasted', extractor: 'ai:extract-pasted-job', by, at }) as const;
  const manual = <const T>(value: T, by: typeof ana | null = ana, at = pastedAt) => ({ value, source: 'manual', by, at }) as const;

  it('Deshacer un pegado con la cabecera escrita aparte', () => {
    const sources: ResolvedPreviewSources = {
      title: manual('Ingeniera de datos'),
      company: manual('Acme'),
      location: pasted('Bolivia'),
      modality: pasted('remote'),
    };

    // El título y la empresa se teclearon en el mismo diálogo: mismo autor, misma fecha, un solo gesto.
    expect(latestPaste(sources)).toEqual({
      by: ana,
      at: pastedAt,
      fields: ['title', 'company', 'location', 'modality'],
    });
  });

  it('leaves out a correction by hand made after the paste', () => {
    const sources: ResolvedPreviewSources = {
      title: manual('Ingeniera de datos senior', ana, later),
      company: manual('Acme SA', beto, pastedAt),
      location: pasted('Bolivia'),
      modality: pasted('remote'),
    };

    expect(latestPaste(sources)?.fields).toEqual(['location', 'modality']);
  });

  it('undoes only the latest of two pastes still on the card, with its own header', () => {
    const sources: ResolvedPreviewSources = {
      title: manual('Ingeniera de datos', beto, pastedAt),
      location: pasted('Bolivia', beto, pastedAt),
      company: manual('Acme', ana, later),
      modality: pasted('remote', ana, later),
    };

    expect(latestPaste(sources)).toEqual({ by: ana, at: later, fields: ['company', 'modality'] });
  });

  it('offers nothing when only fields written by hand are left', () => {
    expect(latestPaste({ title: manual('Ingeniera de datos'), company: manual('Acme') })).toBeNull();
    expect(latestPaste(undefined)).toBeNull();
  });

  it('latestPaste groups hidden-author fields of the same paste', () => {
    const sources: ResolvedPreviewSources = {
      title: manual('Ingeniera de datos', null),
      location: pasted('Bolivia', null),
      modality: pasted('remote', null),
    };

    expect(latestPaste(sources)).toEqual({
      by: null,
      at: pastedAt,
      fields: ['title', 'location', 'modality'],
    });
  });

  it('latestPaste does not mix a hidden and a visible author', () => {
    const sources: ResolvedPreviewSources = {
      title: manual('Ingeniera de datos', ana),
      location: pasted('Bolivia', null),
      modality: pasted('remote', null),
    };

    expect(latestPaste(sources)).toEqual({ by: null, at: pastedAt, fields: ['location', 'modality'] });
  });
});

describe('originText with a hidden author', () => {
  const at = '2026-09-18T10:00:00.000Z';

  it('manual with hidden author reads Escrito por otra persona', () => {
    const origin = fieldOrigin({ value: 'Ingeniera de datos', source: 'manual', by: null, at });
    expect(origin).toEqual({ kind: 'manual', by: null });
    expect(originText(origin)).toBe('Escrito por otra persona');
  });

  it('pasted with hidden author reads Descripción pegada por otra persona', () => {
    const origin = fieldOrigin({
      value: 'Bolivia',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: null,
      at,
    });
    expect(originText(origin)).toBe('Descripción pegada por otra persona');
  });

  it('keeps the name when the author is visible', () => {
    expect(originText({ kind: 'manual', by: { userId: 'u1', displayName: 'Ana' } })).toBe('Escrito por Ana');
  });
});
