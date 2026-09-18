import { describe, expect, it } from 'vitest';
import {
  draftFrom,
  EMPTY_DRAFT,
  hasAnyField,
  hasRequiredFields,
  saysSomething,
  valuesOfDraft,
} from './preview-draft';

// El filtro de valores vacíos (D3 de paste-job-description), que vivía en el dominio del worker. Lo usan el merge del
// worker y el pegado de `api`: un valor que no dice nada no sustituye a uno que sí.

describe('saysSomething', () => {
  it.each([undefined, null, '', '   ', 'unknown', []])(
    'says nothing with %j',
    (value) => {
      expect(saysSomething(value)).toBe(false);
    },
  );

  it.each([
    'Acme',
    'remote',
    0,
    false,
    [{ name: 'TypeScript', required: true }],
    { min: null, max: null, currency: null, period: null },
  ])('says something with %j', (value) => {
    expect(saysSomething(value)).toBe(true);
  });
});

describe('draftFrom', () => {
  it('keeps what the extractor read, with the extractor it came from', () => {
    expect(
      draftFrom('json-ld', { title: 'Arquitecto', company: 'Acme' }),
    ).toEqual({
      title: { value: 'Arquitecto', extractor: 'json-ld' },
      company: { value: 'Acme', extractor: 'json-ld' },
    });
  });

  it('leaves out what says nothing, so an empty value never replaces a full one', () => {
    expect(
      draftFrom('ai:extract-pasted-job', {
        title: 'Arquitecto',
        company: null,
        location: '',
        modality: 'unknown',
        seniority: 'unknown',
        skills: [],
        languages: [],
        summary: '  ',
        postedAt: null,
      }),
    ).toEqual({
      title: { value: 'Arquitecto', extractor: 'ai:extract-pasted-job' },
    });
  });

  it('drops a field that breaks its contract without dropping the others', () => {
    expect(
      draftFrom('json-ld', {
        title: 'Arquitecto',
        summary: 'a'.repeat(601),
        postedAt: '10/09/2026',
      }),
    ).toEqual({ title: { value: 'Arquitecto', extractor: 'json-ld' } });
  });

  it('gives an empty draft when nothing was read', () => {
    expect(draftFrom('metadata', {})).toEqual(EMPTY_DRAFT);
  });
});

describe('valuesOfDraft', () => {
  it('gives the values of a draft without their provenance', () => {
    expect(
      valuesOfDraft(
        draftFrom('json-ld', { title: 'Arquitecto', company: 'Acme' }),
      ),
    ).toEqual({ title: 'Arquitecto', company: 'Acme' });
  });
});

describe('hasRequiredFields and hasAnyField', () => {
  it('asks for a title and a company that say something', () => {
    expect(hasRequiredFields({ title: 'Arquitecto', company: 'Acme' })).toBe(
      true,
    );
    expect(hasRequiredFields({ title: 'Arquitecto', company: null })).toBe(
      false,
    );
    expect(hasRequiredFields({ company: 'Acme' })).toBe(false);
  });

  it('tells whether anything at all was obtained', () => {
    expect(hasAnyField({ title: 'Arquitecto' })).toBe(true);
    expect(hasAnyField({ modality: 'unknown', skills: [] })).toBe(false);
    expect(hasAnyField({})).toBe(false);
  });
});
