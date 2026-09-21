import { z } from 'zod';
import type {
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput,
} from '../../tasks/critique-suggestions.task';
import type { CaseColumn, CaseResult, TaskMetric } from '../evaluable-task';
import { meanOfDefined } from '../metrics/name-set';

// Métricas de `critique-suggestions` (cv-suggestions-review 5.1): MAE del score del juez.

export const critiqueSuggestionsExpectedSchema = z.strictObject({
  score: z.number().min(0).max(1),
  issues: z.array(z.string().min(1)),
});
export type CritiqueSuggestionsExpected = z.infer<
  typeof critiqueSuggestionsExpectedSchema
>;

export type CritiqueSuggestionsCaseResult = CaseResult<
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput,
  CritiqueSuggestionsExpected
>;

export const judgeScoreMae: TaskMetric<
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput,
  CritiqueSuggestionsExpected
> = {
  name: 'judge_score_mae',
  direction: 'lower',
  compute: (cases) =>
    meanOfDefined(
      cases.flatMap(({ goldenCase, result }) =>
        result.status === 'success'
          ? [Math.abs(result.output.score - goldenCase.expected.score)]
          : [],
      ),
    ),
};

export const CRITIQUE_SUGGESTIONS_METRICS = [judgeScoreMae] as const;

export const CRITIQUE_SUGGESTIONS_CASE_COLUMNS: readonly CaseColumn<
  CritiqueSuggestionsInput,
  CritiqueSuggestionsOutput,
  CritiqueSuggestionsExpected
>[] = [
  {
    header: 'Score juez',
    value: ({ result }) =>
      result.status === 'success' ? String(result.output.score) : '',
  },
];
