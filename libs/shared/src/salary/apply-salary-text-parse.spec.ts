import { describe, expect, it } from 'vitest';
import {
  applySalaryTextParse,
  shouldApplySalaryTextParse,
} from './apply-salary-text-parse';
import { PARSE_SALARY_TEXT_EXTRACTOR } from './parse-salary-text';
import type { JobSalary, PreviewSources, StoredPreview } from '../schemas/preview.schema';

const AT = '2026-09-23T12:00:00.000Z';

const EMPTY_SALARY: JobSalary = {
  min: null,
  max: null,
  currency: null,
  period: null,
};

const CURRENCY_ONLY: JobSalary = {
  min: null,
  max: null,
  currency: 'USD',
  period: null,
};

describe('applySalaryTextParse', () => {
  it('fills min/max when only currency was present (auto)', () => {
    const preview: StoredPreview = {
      salary: CURRENCY_ONLY,
      summary: 'from $4000 to $6000 per month',
    };
    const sources: PreviewSources = {
      salary: {
        value: CURRENCY_ONLY,
        source: 'auto',
        extractor: 'json-ld',
        at: AT,
      },
    };

    const result = applySalaryTextParse(
      preview,
      sources,
      'from $4000 to $6000 per month',
      AT,
    );

    expect(result.applied).toBe(true);
    expect(result.preview.salary).toEqual({
      min: 4000,
      max: 6000,
      currency: 'USD',
      period: 'month',
    });
    expect(result.sources.salary).toEqual({
      value: result.preview.salary,
      source: 'auto',
      extractor: PARSE_SALARY_TEXT_EXTRACTOR,
      at: AT,
    });
  });

  it('is a no-op when source is manual', () => {
    const preview: StoredPreview = {
      salary: EMPTY_SALARY,
      summary: 'Sueldo Bs. 5000 mensuales',
    };
    const sources: PreviewSources = {
      salary: {
        value: EMPTY_SALARY,
        source: 'manual',
        by: 'user-1',
        at: AT,
      },
    };

    const summary = preview.summary ?? '';
    const result = applySalaryTextParse(preview, sources, summary, AT);
    expect(result.applied).toBe(false);
    expect(result.preview).toBe(preview);
    expect(result.sources).toBe(sources);
  });

  it('is a no-op when source is pasted', () => {
    const preview: StoredPreview = {
      summary: 'Salary USD 3000 monthly',
    };
    const sources: PreviewSources = {
      salary: {
        value: { min: null, max: null, currency: 'USD', period: null },
        source: 'pasted',
        extractor: 'ai:extract-pasted-job',
        by: 'user-1',
        at: AT,
      },
    };

    expect(
      applySalaryTextParse(preview, sources, 'Salary USD 3000 monthly', AT)
        .applied,
    ).toBe(false);
  });

  it('is a no-op when a numeric extreme already exists', () => {
    const preview: StoredPreview = {
      salary: { min: 1000, max: null, currency: 'USD', period: null },
      summary: 'USD 3000 - 5000 / month',
    };
    expect(shouldApplySalaryTextParse(preview, {})).toBe(false);
    const summary = preview.summary ?? '';
    expect(applySalaryTextParse(preview, {}, summary, AT).applied).toBe(false);
  });

  it('is a no-op when parse fails', () => {
    const preview: StoredPreview = { summary: '5 años de experiencia' };
    const summary = preview.summary ?? '';
    expect(applySalaryTextParse(preview, {}, summary, AT).applied).toBe(false);
  });
});
