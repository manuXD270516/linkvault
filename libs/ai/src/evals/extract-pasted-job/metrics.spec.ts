import type { ExtractJobOutput } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import type { ExtractPastedJobInput } from '../../tasks/extract-pasted-job.task';
import {
  EVALUABLE_TASKS,
  extractPastedJobEvaluable,
  findEvaluableTask,
} from '../evaluable-tasks';
import { computeMetrics } from '../metrics/aggregate';
import {
  degraded,
  success,
  testCaseResult,
} from '../metrics/test-cases.spec-helper';
import {
  EXTRACT_PASTED_JOB_CASE_COLUMNS,
  extractPastedJobExpectedSchema,
  leakedPersonNames,
  personNamesIn,
  summaryPersonNameRate,
  type ExtractPastedJobExpected,
} from './metrics';

// Tarea 4.2 de paste-job-description (D2): `extract-pasted-job` como tarea evaluable, con las métricas de `extract-job`
// más la que falla si el resumen reproduce un nombre de persona sembrado.

const RECRUITER = 'Ximena Choque Arancibia';

function output(summary: string): ExtractJobOutput {
  return {
    isJobPosting: true,
    preview: {
      title: 'Coordinador de Logística',
      company: 'Transportes del Altiplano',
      location: null,
      modality: 'hybrid',
      seniority: 'unknown',
      salary: null,
      skills: [{ name: 'Excel', required: true }],
      languages: [],
      summary,
      postedAt: null,
      expiresAt: null,
    },
  };
}

function expected(personNames?: string[]): ExtractPastedJobExpected {
  return {
    isJobPosting: true,
    title: 'Coordinador de Logística',
    company: 'Transportes del Altiplano',
    modality: 'hybrid',
    skills: ['Excel'],
    ...(personNames === undefined ? {} : { personNames }),
  };
}

function pastedCase(
  id: string,
  caseExpected: ExtractPastedJobExpected,
  result: ReturnType<typeof success<ExtractJobOutput>>,
) {
  return testCaseResult<
    ExtractPastedJobInput,
    ExtractJobOutput,
    ExtractPastedJobExpected
  >({
    id,
    input: { text: 'texto pegado' },
    expected: caseExpected,
    result,
  });
}

describe('personNamesIn', () => {
  it.each([
    ['the full name', `Escribe a ${RECRUITER}.`],
    ['only the first name', 'Coordina con Ximena la flota.'],
    ['a surname, without accents or case', 'según ARANCIBIA'],
  ])('finds %s', (_label, text) => {
    expect(personNamesIn(text, [RECRUITER])).toEqual([RECRUITER]);
  });

  it('folds accents on both sides', () => {
    expect(
      personNamesIn('habló con marcelo gutierrez', ['Marcelo Gutiérrez']),
    ).toEqual(['Marcelo Gutiérrez']);
  });

  it('matches whole words only and ignores short particles', () => {
    expect(personNamesIn('Choquetas y arancel', [RECRUITER])).toEqual([]);
    expect(personNamesIn('La flota de camiones', ['Ana de la Cruz'])).toEqual(
      [],
    );
  });
});

describe('summary_person_name_rate', () => {
  it('fails the case whose summary reproduces a seeded name', () => {
    const cases = [
      pastedCase(
        'fuga',
        expected([RECRUITER]),
        success(output(`Coordina la flota junto a ${RECRUITER}.`)),
      ),
      pastedCase(
        'limpio',
        expected(['Fernanda Ticona']),
        success(output('Coordina la flota de camiones.')),
      ),
    ];

    expect(summaryPersonNameRate.compute(cases)).toBe(0.5);
    expect(
      leakedPersonNames(cases[0]!.goldenCase.expected, output(RECRUITER)),
    ).toEqual([RECRUITER]);
  });

  it('only counts successful job postings with seeded names', () => {
    const cases = [
      pastedCase('sin-nombres', expected(), success(output(RECRUITER))),
      pastedCase('degradado', expected([RECRUITER]), degraded()),
      testCaseResult<
        ExtractPastedJobInput,
        ExtractJobOutput,
        ExtractPastedJobExpected
      >({
        id: 'chat',
        input: { text: 'chat' },
        expected: { isJobPosting: false },
        result: success({ isJobPosting: false, preview: null }),
      }),
    ];

    expect(summaryPersonNameRate.compute(cases)).toBe(0);
  });

  it('shows how many names leaked, never which', () => {
    const column = EXTRACT_PASTED_JOB_CASE_COLUMNS.at(-1);
    const leaked = pastedCase(
      'fuga',
      expected([RECRUITER]),
      success(output(`Pregunta por ${RECRUITER}`)),
    );

    expect(column?.header).toBe('Nombres en summary');
    expect(column?.value(leaked)).toBe('1');
  });
});

describe('extract-pasted-job expected', () => {
  it('rejects person names on a case that is not a job posting', () => {
    expect(
      extractPastedJobExpectedSchema.safeParse({
        isJobPosting: false,
        personNames: [RECRUITER],
      }).success,
    ).toBe(false);
  });
});

describe('evaluable task registry', () => {
  it('registra extract-pasted-job con las métricas de extract-job y la de nombres', () => {
    expect(findEvaluableTask('extract-pasted-job')).toBe(EVALUABLE_TASKS[2]);
    expect(extractPastedJobEvaluable.expectedSchema).toBe(
      extractPastedJobExpectedSchema,
    );

    const metrics = computeMetrics(extractPastedJobEvaluable, [
      pastedCase(
        'oferta',
        expected([RECRUITER]),
        success(output('Coordina la flota de camiones.')),
      ),
    ]);

    expect(
      metrics
        .filter((metric) => metric.kind === 'blocking')
        .map(({ name, value, direction }) => ({ name, value, direction })),
    ).toEqual([
      { name: 'schema_validity_rate', value: 1, direction: 'higher' },
      { name: 'degraded_rate', value: 0, direction: 'lower' },
      { name: 'field_accuracy', value: 1, direction: 'higher' },
      { name: 'skills_recall', value: 1, direction: 'higher' },
      { name: 'skills_precision', value: 1, direction: 'higher' },
      { name: 'summary_person_name_rate', value: 0, direction: 'lower' },
    ]);
  });
});
