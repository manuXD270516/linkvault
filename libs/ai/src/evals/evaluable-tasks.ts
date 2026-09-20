import {
  classifySkillsTask,
  type ClassifySkillsInput,
  type ClassifySkillsOutput,
} from '../tasks/classify-skills.task';
import {
  extractJobTask,
  type ExtractJobInput,
  type ExtractJobOutput,
} from '../tasks/extract-job.task';
import {
  extractPastedJobTask,
  type ExtractPastedJobInput,
  type ExtractPastedJobOutput,
} from '../tasks/extract-pasted-job.task';
import {
  matchCvTask,
  type MatchCvInput,
  type MatchCvOutput,
} from '../tasks/match-cv.task';
import {
  CLASSIFY_SKILLS_CASE_COLUMNS,
  CLASSIFY_SKILLS_METRICS,
  classifySkillsExpectedSchema,
  type ClassifySkillsExpected,
} from './classify-skills/metrics';
import {
  eraseEvaluableTask,
  type AnyEvaluableTask,
  type EvaluableTask,
} from './evaluable-task';
import {
  EXTRACT_JOB_CASE_COLUMNS,
  EXTRACT_JOB_METRICS,
  extractJobExpectedSchema,
  type ExtractJobExpected,
} from './extract-job/metrics';
import {
  EXTRACT_PASTED_JOB_CASE_COLUMNS,
  EXTRACT_PASTED_JOB_METRICS,
  extractPastedJobExpectedSchema,
  type ExtractPastedJobExpected,
} from './extract-pasted-job/metrics';
import {
  MATCH_CV_CASE_COLUMNS,
  MATCH_CV_METRICS,
  matchCvExpectedSchema,
  type MatchCvExpected,
} from './match-cv/metrics';

// Registro de tareas evaluables (D1 y D4 de ai-eval-harness, ADR-019 §2). `--all` evalúa estas tareas, en este orden.
// Toda tarea registrada tiene golden set y viceversa (lo comprueba un test del CLI).

export const classifySkillsEvaluable: EvaluableTask<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  ClassifySkillsExpected
> = {
  task: classifySkillsTask,
  expectedSchema: classifySkillsExpectedSchema,
  metrics: CLASSIFY_SKILLS_METRICS,
  caseColumns: CLASSIFY_SKILLS_CASE_COLUMNS,
};

export const extractJobEvaluable: EvaluableTask<
  ExtractJobInput,
  ExtractJobOutput,
  ExtractJobExpected
> = {
  task: extractJobTask,
  expectedSchema: extractJobExpectedSchema,
  metrics: EXTRACT_JOB_METRICS,
  caseColumns: EXTRACT_JOB_CASE_COLUMNS,
};

export const extractPastedJobEvaluable: EvaluableTask<
  ExtractPastedJobInput,
  ExtractPastedJobOutput,
  ExtractPastedJobExpected
> = {
  task: extractPastedJobTask,
  expectedSchema: extractPastedJobExpectedSchema,
  metrics: EXTRACT_PASTED_JOB_METRICS,
  caseColumns: EXTRACT_PASTED_JOB_CASE_COLUMNS,
};

export const matchCvEvaluable: EvaluableTask<
  MatchCvInput,
  MatchCvOutput,
  MatchCvExpected
> = {
  task: matchCvTask,
  expectedSchema: matchCvExpectedSchema,
  metrics: MATCH_CV_METRICS,
  caseColumns: MATCH_CV_CASE_COLUMNS,
  personalCvGolden: true,
};

export const EVALUABLE_TASKS: readonly AnyEvaluableTask[] = [
  eraseEvaluableTask(classifySkillsEvaluable),
  eraseEvaluableTask(extractJobEvaluable),
  eraseEvaluableTask(extractPastedJobEvaluable),
  eraseEvaluableTask(matchCvEvaluable),
];

/** Tarea evaluable por nombre, o `undefined` si no está registrada. */
export function findEvaluableTask(name: string): AnyEvaluableTask | undefined {
  return EVALUABLE_TASKS.find((evaluable) => evaluable.task.name === name);
}

/** Nombres de las tareas evaluables, en orden de registro. */
export function evaluableTaskNames(): string[] {
  return EVALUABLE_TASKS.map((evaluable) => evaluable.task.name);
}
