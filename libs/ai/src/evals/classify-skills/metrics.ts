import { z } from 'zod';
import type {
  ClassifySkillsInput,
  ClassifySkillsOutput,
} from '../../tasks/classify-skills.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';

// Métricas de `classify-skills` (D5 de ai-eval-harness, requisito "Métricas"): `skills_recall` y `skills_precision`
// comparan nombres de skill normalizados y se agregan como media de los casos con resultado `success`.

/** `expected` de un caso: nombres de las skills que la salida debe contener. */
export const classifySkillsExpectedSchema = z.strictObject({
  skills: z.array(z.string().min(1)),
});
export type ClassifySkillsExpected = z.infer<
  typeof classifySkillsExpectedSchema
>;

export type ClassifySkillsCaseResult = CaseResult<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  ClassifySkillsExpected
>;

/** Puntuación final que se ignora; no incluye `#` ni `+` para no confundir `C#` con `C` ni `C++` con `C`. */
const TRAILING_PUNCTUATION = /[.,;:!?…]+$/u;

/** Minúsculas, espacios colapsados y sin puntuación final. */
export function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim()
    .replace(TRAILING_PUNCTUATION, '')
    .trim();
}

export interface SkillComparison {
  /** Esperadas que la salida no contiene, normalizadas y en orden de `expected`. */
  missing: string[];
  /** De la salida que no se esperaban, normalizadas y en orden de salida. */
  extra: string[];
  /** Esperadas presentes en la salida / esperadas; `null` si no hay esperadas. */
  recall: number | null;
  /** Esperadas presentes en la salida / skills de la salida; `null` si la salida no tiene skills. */
  precision: number | null;
}

/** Compara un caso por nombres normalizados y sin repetidos. */
export function compareSkills(
  expected: ClassifySkillsExpected,
  output: ClassifySkillsOutput,
): SkillComparison {
  const expectedNames = unique(expected.skills.map(normalizeSkillName));
  const outputNames = unique(
    output.skills.map((skill) => normalizeSkillName(skill.name)),
  );
  const expectedSet = new Set(expectedNames);
  const outputSet = new Set(outputNames);
  const hits = expectedNames.filter((name) => outputSet.has(name)).length;

  return {
    missing: expectedNames.filter((name) => !outputSet.has(name)),
    extra: outputNames.filter((name) => !expectedSet.has(name)),
    recall: expectedNames.length === 0 ? null : hits / expectedNames.length,
    precision: outputNames.length === 0 ? null : hits / outputNames.length,
  };
}

export const skillsRecall: TaskMetric<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  ClassifySkillsExpected
> = {
  name: 'skills_recall',
  direction: 'higher',
  compute: (cases) => meanOverSuccess(cases, (c) => c.recall),
};

export const skillsPrecision: TaskMetric<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  ClassifySkillsExpected
> = {
  name: 'skills_precision',
  direction: 'higher',
  compute: (cases) => meanOverSuccess(cases, (c) => c.precision),
};

export const CLASSIFY_SKILLS_METRICS = [skillsRecall, skillsPrecision] as const;

/** Columnas del reporte (D6): skills faltantes y sobrantes, normalizadas; vacías si el caso no es `success`. */
export const CLASSIFY_SKILLS_CASE_COLUMNS: readonly CaseColumn<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  ClassifySkillsExpected
>[] = [
  {
    header: 'Skills faltantes',
    value: (c) => skillList(c, (comparison) => comparison.missing),
  },
  {
    header: 'Skills sobrantes',
    value: (c) => skillList(c, (comparison) => comparison.extra),
  },
];

function skillList(
  { goldenCase, result }: ClassifySkillsCaseResult,
  pick: (comparison: SkillComparison) => readonly string[],
): string {
  if (result.status !== 'success') return '';
  return pick(compareSkills(goldenCase.expected, result.output)).join(', ');
}

/** Media de los casos `success` que aportan valor; 0 si ninguno aporta. */
function meanOverSuccess(
  cases: readonly ClassifySkillsCaseResult[],
  pick: (comparison: SkillComparison) => number | null,
): number {
  const values = cases.flatMap(({ goldenCase, result }) => {
    if (result.status !== 'success') return [];
    const value = pick(compareSkills(goldenCase.expected, result.output));
    return value === null ? [] : [value];
  });
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
