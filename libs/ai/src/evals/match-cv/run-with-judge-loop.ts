import type { RunTaskFn } from '../../application/run-task.usecase';
import type { AiResult } from '../../domain/ai-result';
import { AiProgrammingError } from '../../domain/errors';
import type { Clock } from '../../domain/ports/clock.port';
import {
  critiqueSuggestionsTask,
  toCritiqueSuggestionsInput,
  type CritiqueSuggestionsOutput,
} from '../../tasks/critique-suggestions.task';
import type {
  MatchCvInput,
  MatchCvOutput,
} from '../../tasks/match-cv.task';
import type {
  CaseResult,
  EvaluableTask,
  GoldenCase,
} from '../evaluable-task';
import type { EvalUsageLedger } from '../runner/eval-ports';
import {
  caseContext,
  EvalCaseProgrammingError,
  runCases,
} from '../runner/run-cases';

// Bucle de juez en el eval de match-cv (cv-suggestions-review 5.1): casos con tag `judge-loop` ejecutan
// match-cv → critique-suggestions → (opcional) match-cv otra vez, para medir coste por vuelta.

export const JUDGE_LOOP_TAG = 'judge-loop';

/** Umbral del juez: a partir de aquí no se pide revisión (mismo que el worker). */
const JUDGE_ACCEPT_SCORE = 0.8;

/**
 * Ejecuta los casos: los que llevan `judge-loop` pasan por el bucle; el resto, un solo `runTask`.
 * El resultado del caso sigue siendo el del último `match-cv` exitoso (o el primero si el juez falla).
 */
export async function runMatchCvCases(
  options: {
    evaluable: EvaluableTask<MatchCvInput, MatchCvOutput, unknown>;
    cases: readonly GoldenCase<MatchCvInput, unknown>[];
    runTask: RunTaskFn;
    ledger: EvalUsageLedger;
    clock: Clock;
  },
): Promise<CaseResult<MatchCvInput, MatchCvOutput, unknown>[]> {
  const plain = options.cases.filter(
    (c) => !c.tags.includes(JUDGE_LOOP_TAG),
  );
  const looped = options.cases.filter((c) =>
    c.tags.includes(JUDGE_LOOP_TAG),
  );

  const plainResults =
    plain.length === 0
      ? []
      : await runCases({
          evaluable: options.evaluable,
          cases: plain,
          runTask: options.runTask,
          ledger: options.ledger,
          clock: options.clock,
        });

  const loopResults: CaseResult<MatchCvInput, MatchCvOutput, unknown>[] = [];
  for (const goldenCase of looped) {
    loopResults.push(
      await runOneJudgeLoop({
        evaluable: options.evaluable,
        goldenCase,
        runTask: options.runTask,
        ledger: options.ledger,
        clock: options.clock,
      }),
    );
  }

  // Conservar el orden del golden.
  const byId = new Map(
    [...plainResults, ...loopResults].map((r) => [r.goldenCase.id, r]),
  );
  return options.cases.map((c) => {
    const result = byId.get(c.id);
    if (result === undefined) {
      throw new Error(`missing eval result for case ${c.id}`);
    }
    return result;
  });
}

async function runOneJudgeLoop(options: {
  evaluable: EvaluableTask<MatchCvInput, MatchCvOutput, unknown>;
  goldenCase: GoldenCase<MatchCvInput, unknown>;
  runTask: RunTaskFn;
  ledger: EvalUsageLedger;
  clock: Clock;
}): Promise<CaseResult<MatchCvInput, MatchCvOutput, unknown>> {
  const { evaluable, goldenCase, runTask, ledger, clock } = options;
  ledger.drain();
  const startedAt = clock.now();
  const ctx = caseContext(goldenCase);

  let matchResult: AiResult<MatchCvOutput>;
  try {
    matchResult = await runTask(evaluable.task, goldenCase.input, ctx);
  } catch (error) {
    ledger.drain();
    if (error instanceof AiProgrammingError) {
      throw new EvalCaseProgrammingError(
        evaluable.task.name,
        goldenCase.id,
        goldenCase.key,
        error,
      );
    }
    throw error;
  }

  let finalMatch = matchResult;

  if (matchResult.status === 'success') {
    const critiqueInput = toCritiqueSuggestionsInput(
      goldenCase.input.job,
      matchResult.output,
    );
    let critique: AiResult<CritiqueSuggestionsOutput>;
    try {
      critique = await runTask(critiqueSuggestionsTask, critiqueInput, ctx);
    } catch (error) {
      ledger.drain();
      if (error instanceof AiProgrammingError) {
        throw new EvalCaseProgrammingError(
          'critique-suggestions',
          goldenCase.id,
          goldenCase.key,
          error,
        );
      }
      throw error;
    }

    if (
      critique.status === 'success' &&
      critique.output.score < JUDGE_ACCEPT_SCORE
    ) {
      try {
        const revision = await runTask(
          evaluable.task,
          goldenCase.input,
          ctx,
        );
        if (revision.status === 'success') {
          finalMatch = revision;
        }
      } catch (error) {
        ledger.drain();
        if (error instanceof AiProgrammingError) {
          throw new EvalCaseProgrammingError(
            evaluable.task.name,
            goldenCase.id,
            goldenCase.key,
            error,
          );
        }
        throw error;
      }
    }
  }

  const records = ledger.drain();
  return {
    goldenCase,
    result: finalMatch,
    latencyMs: clock.now() - startedAt,
    usage: {
      inputTokens: records.reduce((sum, r) => sum + r.inputTokens, 0),
      outputTokens: records.reduce((sum, r) => sum + r.outputTokens, 0),
      estCost: records.reduce((sum, r) => sum + r.estCost, 0),
      outcomes: records.map((r) => r.outcome),
      rounds: records.map((r, index) => ({
        round: index,
        task: r.task,
        estCost: r.estCost,
        latencyMs: r.latencyMs,
      })),
    },
  };
}
