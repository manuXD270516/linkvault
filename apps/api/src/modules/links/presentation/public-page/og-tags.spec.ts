import {
  OG_DESCRIPTION_MAX_LENGTH,
  OG_TITLE_MAX_LENGTH,
  type PublicJobPreview,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { FALLBACK_DESCRIPTION, ogDescription, ogTitle } from './og-tags';

const JOB_PAGE =
  'https://www.linkedin.com/jobs/view/backend-senior-en-acme-3811111111/';

const full: PublicJobPreview = {
  platform: 'linkedin',
  displayUrl: JOB_PAGE,
  title: 'Backend Senior',
  company: 'Acme',
  location: 'La Paz',
  modality: 'remote',
  seniority: 'senior',
  salary: { min: 8000, max: 12_000, currency: 'BOB', period: 'month' },
  postedAt: '2026-09-01',
  expiresAt: '2026-10-01',
};

describe('ogTitle', () => {
  it('usa el título del preview', () => {
    expect(ogTitle(full)).toBe('Backend Senior');
  });

  it('Oferta sin preview todavía: la etiqueta derivada de la URL', () => {
    expect(ogTitle({ platform: 'linkedin', displayUrl: JOB_PAGE })).toBe(
      'backend senior en acme 3811111111',
    );
  });

  it('sin título y sin URL publicable, el texto de respaldo', () => {
    expect(ogTitle({ platform: 'generic' })).toBe(FALLBACK_DESCRIPTION);
  });

  it('Título demasiado largo: corta en un límite de palabra y termina en puntos suspensivos', () => {
    const long = `${'Ingeniero de plataforma '.repeat(20)}final`;

    const cut = ogTitle({ ...full, title: long });

    expect([...cut].length).toBeLessThanOrEqual(OG_TITLE_MAX_LENGTH);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toContain(' …');
    expect(long.startsWith(cut.slice(0, -1))).toBe(true);
  });

  it('cuenta code points, no unidades UTF-16', () => {
    const emojis = '🚀'.repeat(OG_TITLE_MAX_LENGTH);

    expect([...ogTitle({ ...full, title: emojis })].length).toBeLessThanOrEqual(
      OG_TITLE_MAX_LENGTH,
    );
    expect([...ogTitle({ ...full, title: '🚀'.repeat(10) })].length).toBe(10);
  });
});

describe('ogDescription', () => {
  it('Descripción con los datos de la oferta', () => {
    expect(ogDescription(full)).toBe(
      'Acme · La Paz · 8.000 – 12.000 BOB al mes · Remoto · Senior · Cierra el 2026-10-01',
    );
  });

  it('el salario va antes que la modalidad y que el nivel', () => {
    const description = ogDescription(full);

    expect(description.indexOf('BOB')).toBeLessThan(
      description.indexOf('Remoto'),
    );
    expect(description.indexOf('BOB')).toBeLessThan(
      description.indexOf('Senior'),
    );
  });

  it('Descripción de respaldo cuando no hay ningún campo', () => {
    expect(ogDescription({ platform: 'generic' })).toBe(FALLBACK_DESCRIPTION);
    expect(ogDescription({ platform: 'generic' })).not.toBe('');
  });

  it('salta los campos que la página no dijo', () => {
    expect(
      ogDescription({
        platform: 'linkedin',
        company: 'Acme',
        modality: 'unknown',
        seniority: 'unknown',
      }),
    ).toBe('Acme');
  });

  it('no dice un salario sin ninguna cifra', () => {
    expect(
      ogDescription({
        platform: 'linkedin',
        company: 'Acme',
        salary: { min: null, max: null, currency: 'BOB', period: 'month' },
      }),
    ).toBe('Acme');
  });

  it.each([
    [{ min: 8000, max: null, currency: 'BOB', period: 'month' } as const, 'Desde 8.000 BOB al mes'],
    [{ min: null, max: 12_000, currency: null, period: null } as const, 'Hasta 12.000'],
    [{ min: 5, max: 9, currency: 'USD', period: 'hour' } as const, '5 – 9 USD por hora'],
  ])('dice el salario %j como %s', (salary, expected) => {
    expect(ogDescription({ platform: 'linkedin', salary })).toBe(expected);
  });

  it('corta a 200 code points en un límite de palabra', () => {
    const description = ogDescription({
      ...full,
      company: 'Acme '.repeat(60).trim(),
    });

    expect([...description].length).toBeLessThanOrEqual(
      OG_DESCRIPTION_MAX_LENGTH,
    );
    expect(description.endsWith('…')).toBe(true);
  });
});
