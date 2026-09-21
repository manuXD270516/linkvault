import type { ExtractJobOutput, JobModality } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  EVALUABLE_TASKS,
  evaluableTaskNames,
  extractJobEvaluable,
  findEvaluableTask,
} from '../evaluable-tasks';
import { computeMetrics } from '../metrics/aggregate';
import {
  degraded,
  success,
  testCaseResult,
} from '../metrics/test-cases.spec-helper';
import {
  compareFields,
  extractJobExpectedSchema,
  fieldAccuracy,
  skillsPrecision,
  skillsRecall,
  type ExtractJobExpected,
} from './metrics';

// Tarea 4.2 de link-enrichment (D8; ADR-019 §2 y §3): `extract-job` como tarea evaluable con su `expected` propio y sus
// métricas de calidad.

interface JobFields {
  title?: string;
  company?: string | null;
  modality?: JobModality;
  skills?: string[];
}

function jobOutput(fields: JobFields = {}): ExtractJobOutput {
  return {
    isJobPosting: true,
    preview: {
      title: fields.title ?? 'Backend Senior',
      company: fields.company === undefined ? 'Acme' : fields.company,
      location: null,
      modality: fields.modality ?? 'remote',
      seniority: 'senior',
      salary: null,
      skills: (fields.skills ?? []).map((name) => ({ name, required: true })),
      languages: [],
      summary: '',
      postedAt: null,
      expiresAt: null,
    },
  };
}

const NOT_A_JOB: ExtractJobOutput = { isJobPosting: false, preview: null };

function jobExpected(fields: JobFields = {}): ExtractJobExpected {
  return {
    isJobPosting: true,
    title: fields.title ?? 'Backend Senior',
    company: fields.company === undefined ? 'Acme' : fields.company,
    modality: fields.modality ?? 'remote',
    skills: fields.skills ?? [],
  };
}

function jobCase(
  id: string,
  expected: ExtractJobExpected,
  result: ReturnType<typeof success<ExtractJobOutput>>,
) {
  return testCaseResult({
    id,
    input: { text: 'placeholder' },
    expected,
    result,
  });
}

describe('extract-job expected schema', () => {
  it('admite una oferta con sus campos y una página que no lo es', () => {
    expect(extractJobExpectedSchema.safeParse(jobExpected()).success).toBe(
      true,
    );
    expect(
      extractJobExpectedSchema.safeParse({ isJobPosting: false }).success,
    ).toBe(true);
  });

  it.each([
    ['una oferta sin título', { isJobPosting: true, company: null }],
    [
      'una modalidad fuera del enum',
      { ...jobExpected(), modality: 'presencial' },
    ],
    ['campos en un caso que no es oferta', { isJobPosting: false, title: 'x' }],
    ['una empresa vacía', { ...jobExpected(), company: '' }],
  ])('rechaza %s', (_label, expected) => {
    expect(extractJobExpectedSchema.safeParse(expected).success).toBe(false);
  });
});

describe('extract-job metrics', () => {
  it('cuenta el discriminador y los tres campos de cada oferta', () => {
    const comparison = compareFields(
      jobExpected({ title: 'Backend Senior', company: 'Acme' }),
      jobOutput({ title: 'backend senior.', company: 'Otra' }),
    );

    // El título acierta tras normalizar; la empresa no.
    expect(comparison).toEqual({ compared: 4, hits: 3, wrong: ['company'] });
  });

  it('acierta una empresa ausente solo respondiendo null', () => {
    expect(
      compareFields(
        jobExpected({ company: null }),
        jobOutput({ company: null }),
      ).wrong,
    ).toEqual([]);
    expect(
      compareFields(
        jobExpected({ company: null }),
        jobOutput({ company: 'Inventada' }),
      ).wrong,
    ).toEqual(['company']);
  });

  it('una página que no es oferta solo arriesga el discriminador', () => {
    expect(compareFields({ isJobPosting: false }, NOT_A_JOB)).toEqual({
      compared: 1,
      hits: 1,
      wrong: [],
    });
    expect(compareFields({ isJobPosting: false }, jobOutput())).toEqual({
      compared: 1,
      hits: 0,
      wrong: ['isJobPosting'],
    });
  });

  it('decir que no es oferta cuando sí lo era falla los cuatro campos', () => {
    expect(compareFields(jobExpected(), NOT_A_JOB)).toEqual({
      compared: 4,
      hits: 0,
      wrong: ['isJobPosting', 'title', 'company', 'modality'],
    });
  });

  it('agrega field_accuracy sobre campos comparados, no sobre casos', () => {
    const cases = [
      jobCase('oferta', jobExpected(), success(jobOutput({ company: 'Otra' }))),
      jobCase('listado', { isJobPosting: false }, success(NOT_A_JOB)),
      jobCase('degradado', jobExpected(), degraded<ExtractJobOutput>()),
    ];

    // 3 de 4 en la oferta y 1 de 1 en el listado: 4 de 5. El caso degradado no aporta.
    expect(fieldAccuracy.compute(cases)).toBeCloseTo(4 / 5, 12);
  });

  it('mide recall y precision de las skills por su nombre normalizado', () => {
    const cases = [
      jobCase(
        'skills',
        jobExpected({ skills: ['TypeScript', 'NestJS', 'Docker'] }),
        success(jobOutput({ skills: ['typescript', 'NestJS.', 'Kafka'] })),
      ),
    ];

    expect(skillsRecall.compute(cases)).toBeCloseTo(2 / 3, 12);
    expect(skillsPrecision.compute(cases)).toBeCloseTo(2 / 3, 12);
  });

  it('no cuenta en recall la página que no es una oferta', () => {
    const cases = [
      jobCase('listado', { isJobPosting: false }, success(NOT_A_JOB)),
      jobCase(
        'oferta',
        jobExpected({ skills: ['Docker'] }),
        success(jobOutput({ skills: ['Docker'] })),
      ),
    ];

    expect(skillsRecall.compute(cases)).toBe(1);
    expect(skillsPrecision.compute(cases)).toBe(1);
  });
});

describe('evaluable task registry', () => {
  it('registra extract-job con su expected schema y sus métricas bloqueantes', () => {
    expect(evaluableTaskNames()).toEqual([
      'classify-skills',
      'extract-job',
      'extract-pasted-job',
      'match-cv',
      'critique-suggestions',
    ]);
    expect(findEvaluableTask('extract-job')).toBe(EVALUABLE_TASKS[1]);
    expect(extractJobEvaluable.expectedSchema).toBe(extractJobExpectedSchema);

    const metrics = computeMetrics(extractJobEvaluable, [
      jobCase(
        'oferta',
        jobExpected({ skills: ['Docker'] }),
        success(jobOutput({ skills: ['Docker'] })),
      ),
    ]);

    expect(
      metrics
        .filter((metric) => metric.kind === 'blocking')
        .map(({ name, value }) => ({ name, value })),
    ).toEqual([
      { name: 'schema_validity_rate', value: 1 },
      { name: 'degraded_rate', value: 0 },
      { name: 'field_accuracy', value: 1 },
      { name: 'skills_recall', value: 1 },
      { name: 'skills_precision', value: 1 },
    ]);
  });
});
