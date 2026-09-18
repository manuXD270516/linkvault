import { jobModalitySchema } from '@linkvault/shared';
import { z } from 'zod';
import type {
  ExtractJobInput,
  ExtractJobOutput,
} from '../../tasks/extract-job.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import {
  compareNameSets,
  normalizeName,
  type NameSetComparison,
} from '../metrics/name-set';

// Métricas de `extract-job` (D8 de link-enrichment, ADR-019 §3): `field_accuracy` sobre los campos que deciden si la
// tarjeta es legible (`title`, `company`, `modality`) y `skills_recall`/`skills_precision` sobre los nombres de las
// habilidades. Ninguna métrica mira `summary` ni las fechas: son texto libre y no se comparan sin ruido.

/**
 * `expected` de un caso, con el mismo discriminador que la salida: de una página que no es una oferta lo único que se
 * espera es que la tarea lo diga, así que no tiene campos que comparar y escribirlos sería mentira.
 */
export const extractJobExpectedSchema = z.discriminatedUnion('isJobPosting', [
  z.strictObject({
    isJobPosting: z.literal(true),
    title: z.string().min(1),
    /** `null` cuando el aviso no nombra a la empresa: acertar es responder `null`, no inventarla. */
    company: z.string().min(1).nullable(),
    modality: jobModalitySchema,
    /** Nombres de las habilidades que el aviso pide; se comparan normalizados. */
    skills: z.array(z.string().min(1)),
  }),
  z.strictObject({ isJobPosting: z.literal(false) }),
]);
export type ExtractJobExpected = z.infer<typeof extractJobExpectedSchema>;

export type ExtractJobCaseResult = CaseResult<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
>;

/** Campos comparados de una oferta, en el orden en que salen en el reporte. */
export const COMPARED_FIELDS = ['title', 'company', 'modality'] as const;
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export interface FieldComparison {
  /** Campos comparados en este caso, incluido siempre el discriminador. */
  compared: number;
  /** Cuántos de ellos coinciden con lo esperado. */
  hits: number;
  /** Campos que no coinciden, con el nombre que se muestra en el reporte. */
  wrong: string[];
}

/**
 * Compara un caso campo a campo. El discriminador cuenta siempre: una salida que dice "no es una oferta" donde sí lo
 * era falla ese campo y además los tres del preview, que es exactamente lo grave de ese error.
 */
export function compareFields(
  expected: ExtractJobExpected,
  output: ExtractJobOutput,
): FieldComparison {
  const wrong: string[] = [];
  if (output.isJobPosting !== expected.isJobPosting) wrong.push('isJobPosting');
  if (!expected.isJobPosting) {
    return { compared: 1, hits: wrong.length === 0 ? 1 : 0, wrong };
  }

  const preview = output.isJobPosting ? output.preview : null;
  if (!sameText(preview?.title ?? null, expected.title)) wrong.push('title');
  if (!sameText(preview?.company ?? null, expected.company)) {
    wrong.push('company');
  }
  if (preview?.modality !== expected.modality) wrong.push('modality');
  return {
    compared: 1 + COMPARED_FIELDS.length,
    hits: 1 + COMPARED_FIELDS.length - wrong.length,
    wrong,
  };
}

/** Habilidades esperadas y las que trae la salida, ya normalizadas. */
export function compareSkills(
  expected: ExtractJobExpected,
  output: ExtractJobOutput,
): NameSetComparison {
  const preview = output.isJobPosting ? output.preview : null;
  return compareNameSets(
    expected.isJobPosting ? expected.skills : [],
    (preview?.skills ?? []).map((skill) => skill.name),
  );
}

/**
 * Aciertos sobre campos comparados en todos los casos `success` (media micro, no media de medias): un caso de oferta
 * aporta cuatro campos y la página de listado aporta uno, que es la proporción de lo que cada caso arriesga.
 */
export const fieldAccuracy: TaskMetric<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
> = {
  name: 'field_accuracy',
  direction: 'higher',
  compute: (cases) => {
    let compared = 0;
    let hits = 0;
    for (const { goldenCase, result } of cases) {
      if (result.status !== 'success') continue;
      const comparison = compareFields(goldenCase.expected, result.output);
      compared += comparison.compared;
      hits += comparison.hits;
    }
    return compared === 0 ? 0 : hits / compared;
  },
};

export const skillsRecall: TaskMetric<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
> = {
  name: 'skills_recall',
  direction: 'higher',
  compute: (cases) => meanOverSuccess(cases, (c) => c.recall),
};

export const skillsPrecision: TaskMetric<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
> = {
  name: 'skills_precision',
  direction: 'higher',
  compute: (cases) => meanOverSuccess(cases, (c) => c.precision),
};

export const EXTRACT_JOB_METRICS = [
  fieldAccuracy,
  skillsRecall,
  skillsPrecision,
] as const;

/** Columnas del reporte por caso: qué campos falló y qué habilidades faltaron. Nunca el texto de la página. */
export const EXTRACT_JOB_CASE_COLUMNS: readonly CaseColumn<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
>[] = [
  {
    header: 'Campos fallados',
    value: ({ goldenCase, result }) =>
      result.status === 'success'
        ? compareFields(goldenCase.expected, result.output).wrong.join(', ')
        : '',
  },
  {
    header: 'Skills faltantes',
    value: ({ goldenCase, result }) =>
      result.status === 'success'
        ? compareSkills(goldenCase.expected, result.output).missing.join(', ')
        : '',
  },
];

/** Media de los casos `success` que aportan valor; 0 si ninguno aporta. */
function meanOverSuccess(
  cases: readonly ExtractJobCaseResult[],
  pick: (comparison: NameSetComparison) => number | null,
): number {
  const values = cases.flatMap(({ goldenCase, result }) => {
    if (result.status !== 'success') return [];
    const value = pick(compareSkills(goldenCase.expected, result.output));
    return value === null ? [] : [value];
  });
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Textos iguales tras normalizar; `null` solo acierta contra `null`. */
function sameText(actual: string | null, expected: string | null): boolean {
  if (expected === null || actual === null) return actual === expected;
  return normalizeName(actual) === normalizeName(expected);
}
