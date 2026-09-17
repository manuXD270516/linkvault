import {
  classifySkillsTask,
  type ClassifySkillsInput,
  type ClassifySkillsOutput,
} from '../tasks/classify-skills.task';
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

export const EVALUABLE_TASKS: readonly AnyEvaluableTask[] = [
  eraseEvaluableTask(classifySkillsEvaluable),
];

/** Tarea evaluable por nombre, o `undefined` si no está registrada. */
export function findEvaluableTask(name: string): AnyEvaluableTask | undefined {
  return EVALUABLE_TASKS.find((evaluable) => evaluable.task.name === name);
}

/** Nombres de las tareas evaluables, en orden de registro. */
export function evaluableTaskNames(): string[] {
  return EVALUABLE_TASKS.map((evaluable) => evaluable.task.name);
}
