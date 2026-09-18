import { jobModalitySchema } from '@linkvault/shared';
import { z } from 'zod';
import type {
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
} from '../../tasks/extract-pasted-job.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import {
  EXTRACT_JOB_CASE_COLUMNS,
  fieldAccuracy,
  skillsPrecision,
  skillsRecall,
} from '../extract-job/metrics';

// Métricas de `extract-pasted-job` (D2 de paste-job-description, ADR-019 §3). La salida es la de `extract-job`, así que
// comparte con ella `field_accuracy`, `skills_recall` y `skills_precision`, calculadas con las mismas funciones: una
// página y un texto pegado se miden igual. Añade una propia, `summary_person_name_rate`, porque lo pegado trae nombres
// de terceros —el reclutador, quien escribe en el chat— y el resumen que se guarda no puede reproducirlos
// (requisito "El texto pegado es un dato personal").

/**
 * `expected` de un caso: el de `extract-job` más, en una oferta, los nombres de persona que aparecen en el texto y que
 * el resumen no puede contener. Una conversación que no es una oferta no tiene resumen, así que no los lleva.
 */
export const extractPastedJobExpectedSchema = z.discriminatedUnion(
  'isJobPosting',
  [
    z.strictObject({
      isJobPosting: z.literal(true),
      title: z.string().min(1),
      company: z.string().min(1).nullable(),
      modality: jobModalitySchema,
      skills: z.array(z.string().min(1)),
      /** Nombres de persona sembrados en el texto; ninguno puede aparecer en `summary`. */
      personNames: z.array(z.string().min(1)).optional(),
    }),
    z.strictObject({ isJobPosting: z.literal(false) }),
  ],
);
export type ExtractPastedJobExpected = z.infer<
  typeof extractPastedJobExpectedSchema
>;

export type ExtractPastedJobCaseResult = CaseResult<
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
  ExtractPastedJobExpected
>;

/** Minúsculas y sin tildes: "Gutiérrez" y "gutierrez" son el mismo nombre. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Partes de un nombre que se buscan sueltas: con tres letras o más, para no confundir un "de" con un apellido. */
const NAME_PART_MIN_LENGTH = 3;

/**
 * Nombres de `names` que aparecen en `text`, completos o por alguna de sus partes, como palabra entera y sin distinguir
 * mayúsculas ni tildes. Basta el nombre de pila para que cuente: "escribe a Ximena" también la identifica.
 */
export function personNamesIn(
  text: string,
  names: readonly string[],
): string[] {
  const words = new Set(fold(text).split(/[^\p{L}\p{N}]+/u));
  return names.filter((name) =>
    fold(name)
      .split(/[^\p{L}\p{N}]+/u)
      .some((part) => part.length >= NAME_PART_MIN_LENGTH && words.has(part)),
  );
}

/** Nombres sembrados que reproduce el `summary` de un caso; `[]` si no es una oferta o no tiene nombres sembrados. */
export function leakedPersonNames(
  expected: ExtractPastedJobExpected,
  output: ExtractPastedJobOutput,
): string[] {
  if (!expected.isJobPosting || expected.personNames === undefined) return [];
  if (!output.isJobPosting || output.preview === null) return [];
  return personNamesIn(output.preview.summary, expected.personNames);
}

/**
 * Proporción de casos `success` con nombres sembrados cuyo `summary` reproduce alguno. Baja es mejor y lo esperado es
 * 0: como toda métrica propia es bloqueante, un prompt o un modelo que empiece a copiar el nombre del reclutador en el
 * resumen falla `eval-ci` contra una línea base de 0.
 */
export const summaryPersonNameRate: TaskMetric<
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
  ExtractPastedJobExpected
> = {
  name: 'summary_person_name_rate',
  direction: 'lower',
  compute: (cases) => {
    let seeded = 0;
    let leaked = 0;
    for (const { goldenCase, result } of cases) {
      const { expected } = goldenCase;
      if (result.status !== 'success') continue;
      if (!expected.isJobPosting || expected.personNames === undefined) {
        continue;
      }
      seeded += 1;
      if (leakedPersonNames(expected, result.output).length > 0) leaked += 1;
    }
    return seeded === 0 ? 0 : leaked / seeded;
  },
};

export const EXTRACT_PASTED_JOB_METRICS: readonly TaskMetric<
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
  ExtractPastedJobExpected
>[] = [fieldAccuracy, skillsRecall, skillsPrecision, summaryPersonNameRate];

/** Columnas de `extract-job` más los nombres que se colaron en el resumen. Nunca el texto pegado. */
export const EXTRACT_PASTED_JOB_CASE_COLUMNS: readonly CaseColumn<
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
  ExtractPastedJobExpected
>[] = [
  ...EXTRACT_JOB_CASE_COLUMNS,
  {
    header: 'Nombres en summary',
    // Solo cuántos: el nombre sembrado es un dato del caso y el reporte no repite valores del input.
    value: ({ goldenCase, result }) =>
      result.status === 'success'
        ? String(leakedPersonNames(goldenCase.expected, result.output).length)
        : '',
  },
];
