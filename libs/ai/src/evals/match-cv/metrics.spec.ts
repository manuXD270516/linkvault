import { describe, expect, it } from 'vitest';
import type { MatchCvInput, MatchCvOutput } from '../../tasks/match-cv.task';
import type { CaseResult } from '../evaluable-task';
import {
  success,
  testCaseResult,
} from '../metrics/test-cases.spec-helper';
import {
  meanCostByRound,
  pearson,
  scoreLabelCorrelation,
  type MatchCvExpected,
} from './metrics';

// cv-suggestions-review 5.1: correlación score/etiqueta y coste por vuelta.

function matchCase(options: {
  id: string;
  score: number;
  humanLabel?: 1 | 2 | 3 | 4 | 5;
  estCost?: number;
  rounds?: CaseResult<MatchCvInput, MatchCvOutput, MatchCvExpected>['usage']['rounds'];
}): CaseResult<MatchCvInput, MatchCvOutput, MatchCvExpected> {
  const result = testCaseResult({
    id: options.id,
    input: {
      job: { title: 't', text: 'x', skills: [] },
      cv: { text: 'y' },
    },
    expected: {
      matchedSkills: [],
      missingSkills: [],
      score: options.score,
    },
    result: success({
      score: options.score,
      matchedSkills: [],
      missingSkills: [],
      suggestions: [],
    } satisfies MatchCvOutput),
    estCost: options.estCost ?? 0,
  });
  if (options.humanLabel !== undefined) {
    (result.goldenCase as { humanLabel?: number }).humanLabel =
      options.humanLabel;
  }
  if (options.rounds !== undefined) {
    result.usage = { ...result.usage, rounds: options.rounds };
  }
  return result;
}

describe('scoreLabelCorrelation', () => {
  it('returns Pearson correlation between score and humanLabel', () => {
    const cases = [
      matchCase({ id: 'a', score: 100, humanLabel: 5 }),
      matchCase({ id: 'b', score: 80, humanLabel: 4 }),
      matchCase({ id: 'c', score: 40, humanLabel: 2 }),
      matchCase({ id: 'd', score: 20, humanLabel: 1 }),
    ];
    expect(scoreLabelCorrelation(cases)).toBeCloseTo(1, 5);
  });

  it('returns 0 with fewer than two labeled successes', () => {
    expect(
      scoreLabelCorrelation([
        matchCase({ id: 'a', score: 100, humanLabel: 5 }),
      ]),
    ).toBe(0);
    expect(scoreLabelCorrelation([matchCase({ id: 'a', score: 100 })])).toBe(0);
  });
});

describe('pearson', () => {
  it('is 0 when one side has no variance', () => {
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });
});

describe('meanCostByRound', () => {
  it('averages cost per round index across cases', () => {
    const cases = [
      matchCase({
        id: 'two-rounds',
        score: 50,
        rounds: [
          { round: 0, task: 'match-cv', estCost: 0.02, latencyMs: 10 },
          { round: 1, task: 'critique-suggestions', estCost: 0.01, latencyMs: 5 },
        ],
      }),
      matchCase({
        id: 'one-round',
        score: 60,
        rounds: [
          { round: 0, task: 'match-cv', estCost: 0.04, latencyMs: 10 },
        ],
      }),
    ];
    expect(meanCostByRound(cases)).toEqual([
      { round: 0, task: 'match-cv', estCost: 0.03 },
      { round: 1, task: 'critique-suggestions', estCost: 0.01 },
    ]);
  });
});
