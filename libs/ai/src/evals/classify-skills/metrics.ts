import { z } from 'zod';
import type {
  ClassifySkillsInput,
  ClassifySkillsOutput,
} from '../../tasks/classify-skills.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import {
  compareNameSets,
  meanOfDefined,
  normalizeName,
  type NameSetComparison,
} from '../metrics/name-set';

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

/** Minúsculas, espacios colapsados y sin puntuación final (`normalizeName` de `evals/metrics/name-set`). */
export const normalizeSkillName = normalizeName;

export type SkillComparison = NameSetComparison;

/** Compara un caso por nombres normalizados y sin repetidos. */
export function compareSkills(
  expected: ClassifySkillsExpected,
  output: ClassifySkillsOutput,
): SkillComparison {
  return compareNameSets(
    expected.skills,
    output.skills.map((skill) => skill.name),
  );
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
  return meanOfDefined(
    cases.flatMap(({ goldenCase, result }) =>
      result.status === 'success'
        ? [pick(compareSkills(goldenCase.expected, result.output))]
        : [],
    ),
  );
}
