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

// Métricas de `match-cv` (cv-match-suggestions 6.12): recall/precision de skills emparejadas y ausentes, y error
// absoluto medio del score normalizado a [0, 1] (lower is better).

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

export const MATCH_CV_METRICS = [
  matchedSkillsRecall,
  matchedSkillsPrecision,
  missingSkillsRecall,
  scoreMae,
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
