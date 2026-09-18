import { executionKey } from '../../application/execution-key';
import type { PendingFixture } from '../../application/pending-fixtures';
import type { AnyEvaluableTask, GoldenCase } from '../evaluable-task';

// Entradas anotadas por `runTask` convertidas en casos grabables (tarea 4.7 de link-enrichment). Así `--from-pending`
// reutiliza `recordFixtures` tal cual: mismo salto de los que ya tienen fixture, mismo informe y mismos fallos.
//
// Una anotación puede quedar obsoleta entre que se escribe y se graba (cambia el prompt, cambia el `inputSchema`), y
// una de tarea `personal` nunca trae su entrada. Ninguna de esas se graba a ciegas: se listan con su motivo.

export interface PendingGroup {
  evaluable: AnyEvaluableTask;
  cases: GoldenCase<unknown, unknown>[];
}

export interface PendingSkip {
  task: string;
  key: string;
  reason: string;
}

export interface PendingCasesResult {
  /** Un grupo por tarea, en el orden en que aparece su primera entrada. */
  groups: PendingGroup[];
  /** Entradas que no se pueden grabar, con el motivo. */
  skipped: PendingSkip[];
}

/** Identificador legible de una entrada anotada: no hay `id` de golden del que tirar. */
export function pendingCaseId(entry: PendingFixture): string {
  return `${entry.task}:${entry.key.slice(0, 12)}`;
}

export function pendingCases(
  entries: readonly PendingFixture[],
  tasks: readonly AnyEvaluableTask[],
): PendingCasesResult {
  const groups = new Map<string, PendingGroup>();
  const skipped: PendingSkip[] = [];

  entries.forEach((entry, index) => {
    const skip = (reason: string): void => {
      skipped.push({ task: entry.task, key: entry.key, reason });
    };
    if (entry.redacted) {
      skip(
        'annotated without its input: the task is personal and its input is never written to the registry',
      );
      return;
    }
    const evaluable = tasks.find((e) => e.task.name === entry.task);
    if (evaluable === undefined) {
      skip('task is not registered as evaluable');
      return;
    }
    const { task } = evaluable;
    if (entry.promptVersion !== task.promptVersion) {
      skip(
        `annotated for prompt ${entry.promptVersion}, current is ${task.promptVersion}`,
      );
      return;
    }

    const input = task.inputSchema.safeParse(entry.input);
    if (!input.success) {
      skip('input no longer valid for the task schema');
      return;
    }
    const key = executionKey({
      taskName: task.name,
      promptVersion: task.promptVersion,
      outputLanguage: entry.outputLanguage,
      input: input.data,
    });
    // Si la clave ya no sale, grabar escribiría un fixture que ningún replay leería.
    if (key !== entry.key) {
      skip('stale annotation: the execution key no longer matches its input');
      return;
    }

    const group = groups.get(entry.task) ?? { evaluable, cases: [] };
    group.cases.push({
      line: index + 1,
      id: pendingCaseId(entry),
      input: input.data,
      // `recordFixtures` no compara nada: el `expected` de una entrada anotada no existe.
      expected: undefined,
      tags: ['pending'],
      outputLanguage: entry.outputLanguage,
      key,
    });
    groups.set(entry.task, group);
  });

  return { groups: [...groups.values()], skipped };
}
