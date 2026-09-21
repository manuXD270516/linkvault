import { describe, expect, it } from 'vitest';
import {
  CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH,
  critiqueMatchReportSchema,
  critiqueSuggestionEvidenceSchema,
  critiqueSuggestionSchema,
  critiqueSuggestionsInputSchema,
  critiqueSuggestionsOutputSchema,
} from './critique-suggestions.schema';

const evidence = {
  jobRequirement: 'TypeScript',
  importance: 'must',
} as const;

const suggestion = {
  section: 'Experience',
  after: 'Built APIs in [EMAIL_1] for three years.',
  reason: 'The role requires TypeScript.',
  evidence,
} as const;

function report(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    score: 72,
    matchedSkills: ['TypeScript'],
    missingSkills: [{ name: 'Kubernetes', importance: 'nice' }],
    suggestions: [suggestion],
    ...overrides,
  };
}

function job(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    title: 'Backend Engineer',
    text: 'We need TypeScript and Kubernetes.',
    skills: [
      { name: 'TypeScript', importance: 'must' },
      { name: 'Kubernetes', importance: 'nice' },
    ],
    ...overrides,
  };
}

describe('critiqueSuggestionEvidenceSchema', () => {
  it('acepta jobRequirement e importance sin cvFragment', () => {
    expect(critiqueSuggestionEvidenceSchema.parse(evidence)).toEqual(evidence);
  });

  it.each([
    ['cvFragment', { ...evidence, cvFragment: 'secret@example.com' }],
    ['campo inventado', { ...evidence, extra: true }],
    ['jobRequirement vacío', { ...evidence, jobRequirement: '' }],
    ['importance ausente', { jobRequirement: 'TypeScript' }],
  ] as const)('rechaza %s', (_label, value) => {
    expect(critiqueSuggestionEvidenceSchema.safeParse(value).success).toBe(
      false,
    );
  });
});

describe('critiqueSuggestionSchema', () => {
  it('acepta after con marcadores y sin before', () => {
    expect(critiqueSuggestionSchema.parse(suggestion)).toEqual(suggestion);
  });

  it('rechaza before y cvFragment', () => {
    expect(
      critiqueSuggestionSchema.safeParse({
        ...suggestion,
        before: 'old text with secret@example.com',
      }).success,
    ).toBe(false);
    expect(
      critiqueSuggestionSchema.safeParse({
        ...suggestion,
        evidence: { ...evidence, cvFragment: 'secret@example.com' },
      }).success,
    ).toBe(false);
  });
});

describe('critiqueMatchReportSchema', () => {
  it('acepta el núcleo del informe sin PII del CV', () => {
    expect(critiqueMatchReportSchema.parse(report())).toMatchObject({
      score: 72,
      suggestions: [suggestion],
    });
  });

  it('rechaza evidencia con cvFragment', () => {
    expect(
      critiqueMatchReportSchema.safeParse(
        report({
          suggestions: [
            {
              ...suggestion,
              evidence: { ...evidence, cvFragment: 'email@x.com' },
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });
});

describe('critiqueSuggestionsInputSchema', () => {
  it('acepta oferta + informe sin cvFragment ni before', () => {
    const parsed = critiqueSuggestionsInputSchema.parse({
      job: job(),
      report: report(),
    });
    expect(parsed.job.title).toBe('Backend Engineer');
    expect(parsed.report.suggestions[0]?.after).toContain('[EMAIL_1]');
  });

  it(`recorta el texto de la vacante a ${String(CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH)}`, () => {
    const long = 'x'.repeat(CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH + 500);
    const parsed = critiqueSuggestionsInputSchema.parse({
      job: job({ text: long }),
      report: report(),
    });
    expect(parsed.job.text).toHaveLength(CRITIQUE_SUGGESTIONS_JOB_TEXT_MAX_LENGTH);
  });

  it.each([
    [
      'cvFragment en evidencia',
      {
        job: job(),
        report: report({
          suggestions: [
            {
              ...suggestion,
              evidence: { ...evidence, cvFragment: 'PII' },
            },
          ],
        }),
      },
    ],
    [
      'before en sugerencia',
      {
        job: job(),
        report: report({
          suggestions: [{ ...suggestion, before: 'old' }],
        }),
      },
    ],
    [
      'campo de más en la raíz',
      { job: job(), report: report(), cvText: 'secret' },
    ],
  ] as const)('rechaza %s', (_label, value) => {
    expect(critiqueSuggestionsInputSchema.safeParse(value).success).toBe(false);
  });
});

describe('critiqueSuggestionsOutputSchema', () => {
  it.each([
    ['score 0.8 con issues', { score: 0.8, issues: ['weak evidence'] }, true],
    ['score 0 sin issues', { score: 0, issues: [] }, true],
    ['score 1', { score: 1, issues: ['ok'] }, true],
    ['score 1.1', { score: 1.1, issues: [] }, false],
    ['score -0.1', { score: -0.1, issues: [] }, false],
    ['issues con cadena vacía', { score: 0.5, issues: [''] }, false],
    ['sin issues', { score: 0.5 }, false],
    ['campo de más', { score: 0.5, issues: [], model: 'x' }, false],
  ] as const)('%s → válido: %s', (_label, value, valid) => {
    expect(critiqueSuggestionsOutputSchema.safeParse(value).success).toBe(
      valid,
    );
  });
});
