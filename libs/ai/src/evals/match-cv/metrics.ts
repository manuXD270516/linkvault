import { z } from 'zod';
import { skillImportanceSchema } from '@linkvault/shared';
import type {
  MatchCvInput,
  MatchCvOutput,
} from '../../tasks/match-cv.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import {
  compareNameSets,
  meanOfDefined,
  type NameSetComparison,
} from '../metrics/name-set';

// Métricas de `match-cv` (cv-match-suggestions 6.12; cv-suggestions-review 5.1): recall/precision de skills,
// MAE del score, y correlación del score con etiquetas humanas 1–5.

export const matchCvExpectedSchema = z.strictObject({
  matchedSkills: z.array(z.string().min(1)),
  missingSkills: z.array(
    z.strictObject({
      name: z.string().min(1),
      importance: skillImportanceSchema,
    }),
  ),
  score: z.number().int().min(0).max(100),
});
export type MatchCvExpected = z.infer<typeof matchCvExpectedSchema>;

export type MatchCvCaseResult = CaseResult<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
>;

export function compareMatchedSkills(
  expected: MatchCvExpected,
  output: MatchCvOutput,
): NameSetComparison {
  return compareNameSets(expected.matchedSkills, output.matchedSkills);
}

export function compareMissingSkills(
  expected: MatchCvExpected,
  output: MatchCvOutput,
): NameSetComparison {
  return compareNameSets(
    expected.missingSkills.map((s) => s.name),
    output.missingSkills.map((s) => s.name),
  );
}

export const matchedSkillsRecall: TaskMetric<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  name: 'matched_skills_recall',
  direction: 'higher',
  compute: (cases) =>
    meanOverSuccess(cases, (c) => compareMatchedSkills(c.expected, c.output).recall),
};

export const matchedSkillsPrecision: TaskMetric<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  name: 'matched_skills_precision',
  direction: 'higher',
  compute: (cases) =>
    meanOverSuccess(cases, (c) =>
      compareMatchedSkills(c.expected, c.output).precision,
    ),
};

export const missingSkillsRecall: TaskMetric<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  name: 'missing_skills_recall',
  direction: 'higher',
  compute: (cases) =>
    meanOverSuccess(cases, (c) => compareMissingSkills(c.expected, c.output).recall),
};

export const scoreMae: TaskMetric<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  name: 'score_mae',
  direction: 'lower',
  compute: (cases) =>
    meanOfDefined(
      cases.flatMap(({ goldenCase, result }) =>
        result.status === 'success'
          ? [Math.abs(result.output.score - goldenCase.expected.score) / 100]
          : [],
      ),
    ),
};

/**
 * Correlación de Pearson entre el `score` del informe (0–100) y `humanLabel` (1–5).
 * 0 si hay menos de dos pares etiquetados con éxito.
 */
export function scoreLabelCorrelation(
  cases: readonly MatchCvCaseResult[],
): number {
  const pairs = cases.flatMap(({ goldenCase, result }) => {
    if (result.status !== 'success') return [];
    if (goldenCase.humanLabel === undefined) return [];
    return [{ score: result.output.score, label: goldenCase.humanLabel }];
  });
  return pearson(
    pairs.map((p) => p.score),
    pairs.map((p) => p.label),
  );
}

export const scoreLabelCorrelationMetric: TaskMetric<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  name: 'score_label_correlation',
  direction: 'higher',
  compute: scoreLabelCorrelation,
};

export const MATCH_CV_METRICS = [
  matchedSkillsRecall,
  matchedSkillsPrecision,
  missingSkillsRecall,
  scoreMae,
  scoreLabelCorrelationMetric,
] as const;

export const MATCH_CV_CASE_COLUMNS: readonly CaseColumn<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
>[] = [
  {
    header: 'Matched faltantes',
    value: (c) => listMissing(c, compareMatchedSkills),
  },
  {
    header: 'Missing faltantes',
    value: (c) => listMissing(c, compareMissingSkills),
  },
];

/** Media de coste estimado por índice de vuelta (casos con al menos esa vuelta). */
export function meanCostByRound(
  cases: readonly CaseResult<unknown, unknown, unknown>[],
): readonly { round: number; task: string; estCost: number }[] {
  const byRound = new Map<number, { task: string; costs: number[] }>();
  for (const { usage } of cases) {
    for (const entry of usage.rounds) {
      const bucket = byRound.get(entry.round);
      if (bucket === undefined) {
        byRound.set(entry.round, { task: entry.task, costs: [entry.estCost] });
      } else {
        bucket.costs.push(entry.estCost);
      }
    }
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => a - b)
    .map(([round, { task, costs }]) => ({
      round,
      task,
      estCost: costs.reduce((sum, c) => sum + c, 0) / costs.length,
    }));
}

/** Pearson; 0 si no hay varianza o menos de 2 puntos. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length < 2 || xs.length !== ys.length) return 0;
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = (xs[i] ?? 0) - meanX;
    const dy = (ys[i] ?? 0) - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 0;
  return num / Math.sqrt(denX * denY);
}

function listMissing(
  { goldenCase, result }: MatchCvCaseResult,
  compare: (
    expected: MatchCvExpected,
    output: MatchCvOutput,
  ) => NameSetComparison,
): string {
  if (result.status !== 'success') return '';
  return compare(goldenCase.expected, result.output).missing.join(', ');
}

function meanOverSuccess(
  cases: readonly MatchCvCaseResult[],
  pick: (c: {
    expected: MatchCvExpected;
    output: MatchCvOutput;
  }) => number | null,
): number {
  return meanOfDefined(
    cases.flatMap(({ goldenCase, result }) =>
      result.status === 'success'
        ? [pick({ expected: goldenCase.expected, output: result.output })]
        : [],
    ),
  );
}
