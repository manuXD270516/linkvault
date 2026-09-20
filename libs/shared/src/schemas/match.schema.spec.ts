import { describe, expect, it } from 'vitest';
import {
  MATCH_CV_FRAGMENT_MAX_CHARS,
  MATCH_DEGRADED_REASONS,
  MATCH_SUGGESTIONS_MAX,
  matchAnalysisResponseSchema,
  matchDegradedReasonSchema,
  matchLatestSchema,
  matchReportSchema,
  matchRequestAcceptedSchema,
  matchRunningSchema,
  matchSuggestionSchema,
  missingSkillSchema,
  requestMatchRequestSchema,
  suggestionEvidenceSchema,
} from './match.schema';

const DATE = '2026-09-20T12:00:00.000Z';
const RETRY_AT = '2026-09-21T12:00:00.000Z';

const evidence = {
  jobRequirement: 'TypeScript',
  importance: 'must',
  cvFragment: '3 years of TypeScript',
} as const;

const suggestion = {
  section: 'Experience',
  after: 'Built APIs in TypeScript for three years.',
  reason: 'The role requires TypeScript.',
  evidence,
} as const;

function coreReport(
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

function fullReport(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...coreReport(),
    degraded: false,
    ...overrides,
  };
}

describe('missingSkillSchema', () => {
  it('acepta name e importance must|nice', () => {
    expect(
      missingSkillSchema.parse({ name: 'Go', importance: 'must' }),
    ).toEqual({ name: 'Go', importance: 'must' });
  });

  it.each(['', undefined])('rechaza name vacío o ausente (%j)', (name) => {
    expect(
      missingSkillSchema.safeParse({ name, importance: 'must' }).success,
    ).toBe(false);
  });
});

describe('suggestionEvidenceSchema', () => {
  it.each([
    ['completa', evidence, true],
    [
      'cvFragment nulo',
      { ...evidence, cvFragment: null },
      true,
    ],
    [
      'jobRequirement vacío',
      { ...evidence, jobRequirement: '' },
      false,
    ],
    [
      'jobRequirement ausente',
      { importance: 'must', cvFragment: null },
      false,
    ],
    [
      'importance ausente',
      { jobRequirement: 'TypeScript', cvFragment: null },
      false,
    ],
    [
      'importance inventada',
      { ...evidence, importance: 'critical' },
      false,
    ],
    [
      'cvFragment de 2000 caracteres',
      { ...evidence, cvFragment: 'x'.repeat(2000) },
      false,
    ],
  ] as const)('%s → válido: %s', (_label, value, valid) => {
    expect(suggestionEvidenceSchema.safeParse(value).success).toBe(valid);
  });

  it(`acota cvFragment a ${String(MATCH_CV_FRAGMENT_MAX_CHARS)}`, () => {
    expect(
      suggestionEvidenceSchema.safeParse({
        ...evidence,
        cvFragment: 'x'.repeat(MATCH_CV_FRAGMENT_MAX_CHARS),
      }).success,
    ).toBe(true);
  });
});

describe('matchSuggestionSchema', () => {
  it('exige sección, texto propuesto, motivo y evidencia', () => {
    expect(matchSuggestionSchema.parse(suggestion)).toEqual(suggestion);
  });
});

describe('matchDegradedReasonSchema', () => {
  it('admite exactamente los cuatro motivos', () => {
    expect(MATCH_DEGRADED_REASONS).toEqual([
      'no_providers',
      'providers_failed',
      'quota_exceeded',
      'consent_required',
    ]);
    expect(matchDegradedReasonSchema.options).toEqual([
      ...MATCH_DEGRADED_REASONS,
    ]);
  });
});

describe('matchReportSchema', () => {
  it.each([
    [
      '13 sugerencias',
      fullReport({
        suggestions: Array.from({ length: MATCH_SUGGESTIONS_MAX + 1 }, () => suggestion),
      }),
      false,
    ],
    [
      'degradado con una sugerencia',
      fullReport({
        degraded: true,
        degradedReason: 'no_providers',
        suggestions: [suggestion],
      }),
      false,
    ],
    [
      'degradado sin motivo',
      fullReport({ degraded: true, suggestions: [] }),
      false,
    ],
    [
      'cuota agotada sin aiQuotaRetryAt',
      fullReport({
        degraded: true,
        degradedReason: 'quota_exceeded',
        suggestions: [],
      }),
      false,
    ],
    [
      'motivo de consentimiento con aiQuotaRetryAt',
      fullReport({
        degraded: true,
        degradedReason: 'consent_required',
        suggestions: [],
        aiQuotaRetryAt: RETRY_AT,
      }),
      false,
    ],
    ['score 101', fullReport({ score: 101 }), false],
    ['score 0 válido', fullReport({ score: 0 }), true],
  ] as const)('%s → válido: %s', (_label, value, valid) => {
    expect(matchReportSchema.safeParse(value).success).toBe(valid);
  });

  it('acepta un informe completo y uno degradado por cuota con hora de vuelta', () => {
    expect(matchReportSchema.parse(fullReport())).toMatchObject({
      degraded: false,
      score: 72,
    });
    expect(
      matchReportSchema.parse(
        fullReport({
          degraded: true,
          degradedReason: 'quota_exceeded',
          suggestions: [],
          aiQuotaRetryAt: RETRY_AT,
        }),
      ),
    ).toMatchObject({ degradedReason: 'quota_exceeded', aiQuotaRetryAt: RETRY_AT });
  });

  it('prohíbe motivo y hora de vuelta cuando no está degradado', () => {
    expect(
      matchReportSchema.safeParse(
        fullReport({ degradedReason: 'no_providers' }),
      ).success,
    ).toBe(false);
  });
});

describe('requestMatchRequestSchema', () => {
  it('acepta el cuerpo vacío y un cvId', () => {
    expect(requestMatchRequestSchema.parse({})).toEqual({});
    expect(requestMatchRequestSchema.parse({ cvId: 'cv-1' })).toEqual({
      cvId: 'cv-1',
    });
  });

  it('rechaza un campo desconocido', () => {
    expect(
      requestMatchRequestSchema.safeParse({ force: true }).success,
    ).toBe(false);
  });
});

describe('matchRequestAcceptedSchema', () => {
  const accepted = {
    analysisId: 'a1',
    linkId: 'l1',
    cvId: 'c1',
    status: 'running',
    step: 'reading-job',
    requestedAt: DATE,
  } as const;

  it('acepta el cuerpo plano del 202', () => {
    expect(matchRequestAcceptedSchema.parse(accepted)).toEqual(accepted);
  });

  it.each(['cvText', 'jobText', 'prompt', 'providerApiKey'])(
    'rechaza %s en la respuesta del POST',
    (field) => {
      expect(
        matchRequestAcceptedSchema.safeParse({ ...accepted, [field]: 'x' })
          .success,
      ).toBe(false);
    },
  );
});

describe('match GET blocks', () => {
  const report = fullReport();

  const latestDone = {
    analysisId: 'a1',
    cvId: 'c1',
    status: 'done',
    step: 'done',
    requestedAt: DATE,
    analyzedAt: DATE,
    stale: false,
    cvChanged: false,
    consentRequired: false,
    report,
  } as const;

  const running = {
    analysisId: 'a2',
    cvId: 'c1',
    status: 'running',
    step: 'comparing-cv',
    requestedAt: DATE,
    maxAgeMs: 120_000,
  } as const;

  it.each([
    ['solo latest', { linkId: 'l1', latest: latestDone }, true],
    ['solo running', { linkId: 'l1', running }, true],
    [
      'los dos a la vez',
      { linkId: 'l1', latest: latestDone, running },
      true,
    ],
    [
      'running con consentRequired',
      { linkId: 'l1', running: { ...running, consentRequired: false } },
      false,
    ],
    [
      'running con report',
      { linkId: 'l1', running: { ...running, report } },
      false,
    ],
    [
      'running sin maxAgeMs',
      {
        linkId: 'l1',
        running: {
          analysisId: 'a2',
          cvId: 'c1',
          status: 'running',
          step: 'comparing-cv',
          requestedAt: DATE,
        },
      },
      false,
    ],
    [
      'latest con maxAgeMs',
      { linkId: 'l1', latest: { ...latestDone, maxAgeMs: 120_000 } },
      false,
    ],
    [
      'latest sin consentRequired',
      {
        linkId: 'l1',
        latest: Object.fromEntries(
          Object.entries(latestDone).filter(([key]) => key !== 'consentRequired'),
        ),
      },
      false,
    ],
    [
      'latest en done con failureCode',
      {
        linkId: 'l1',
        latest: { ...latestDone, failureCode: 'internal_error' },
      },
      false,
    ],
  ] as const)('%s → válido: %s', (_label, value, valid) => {
    expect(matchAnalysisResponseSchema.safeParse(value).success).toBe(valid);
  });

  it('exige failureCode en failed y report en done', () => {
    expect(
      matchLatestSchema.safeParse({
        ...latestDone,
        status: 'failed',
        step: 'failed',
        report: undefined,
      }).success,
    ).toBe(false);
    expect(
      matchLatestSchema.parse({
        ...latestDone,
        status: 'failed',
        step: 'failed',
        failureCode: 'internal_error',
        report: undefined,
      }),
    ).toMatchObject({ failureCode: 'internal_error' });
  });

  it('publica aiQuotaRetryAt solo con degradado por cuota', () => {
    const quotaReport = fullReport({
      degraded: true,
      degradedReason: 'quota_exceeded',
      suggestions: [],
      aiQuotaRetryAt: RETRY_AT,
    });

    expect(
      matchLatestSchema.safeParse({
        ...latestDone,
        report: quotaReport,
      }).success,
    ).toBe(false);
    expect(
      matchLatestSchema.parse({
        ...latestDone,
        report: quotaReport,
        aiQuotaRetryAt: RETRY_AT,
      }),
    ).toMatchObject({ aiQuotaRetryAt: RETRY_AT });
  });

  it('running exige maxAgeMs y nada más', () => {
    expect(matchRunningSchema.parse(running)).toEqual(running);
  });
});
