import type { JobSalary } from '@linkvault/shared';
import {
  daysSince,
  fieldOrigin,
  formatSalary,
  linkLabel,
  modalityLabel,
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

describe('linkLabel', () => {
  it.each([
    [
      'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=share',
      'senior backend engineer at acme 3912345678',
    ],
    [
      'https://co.computrabajo.com/trabajo-de-analista-de-datos-en-acme-1A2B3C',
      'trabajo de analista de datos en acme 1A2B3C',
    ],
    ['https://ejemplo.test/ofertas/analista.html', 'analista'],
    ['https://ejemplo.test/ofertas/desarrollador%20senior', 'desarrollador senior'],
    ['https://ejemplo.test/ofertas/analista/', 'analista'],
    ['https://www.getonboard.com/', 'getonboard.com'],
    ['https://ejemplo.test', 'ejemplo.test'],
    ['no-es-una-url', 'no-es-una-url'],
  ])('derives the label of %s', (url, expected) => {
    expect(linkLabel(url)).toBe(expected);
  });
});

describe('platformName', () => {
  it('names the platforms with their own brand', () => {
    expect(platformName('linkedin')).toBe('LinkedIn');
    expect(platformName('getonboard')).toBe('Get on Board');
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
