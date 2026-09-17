import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { executionKey } from '../application/execution-key';
import { outputLanguageOf } from '../domain/run-context';
import type { EvaluableTask, GoldenCase } from './evaluable-task';

// Línea del golden set y cargador JSONL (D4 de ai-eval-harness, requisito "Golden set por tarea"). Valida JSON por línea,
// `id` únicos, `input` contra la tarea, `expected` contra `expectedSchema` y claves de ejecución distintas. Los errores
// nombran la línea y el `id` y nunca repiten valores del caso: solo rutas y mensajes de zod.

export const GOLDEN_FILE_NAME = 'golden.jsonl';

/** Forma de una línea antes de validar `input` y `expected` contra sus schemas. Sin claves desconocidas. */
export const goldenLineSchema = z.strictObject({
  id: z.string().min(1),
  input: z.unknown(),
  expected: z.unknown(),
  tags: z.array(z.string().min(1)),
  outputLanguage: z.enum(['es', 'en']).optional(),
});

export interface GoldenIssue {
  /** Ausente en problemas del archivo completo (inexistente o vacío). */
  line?: number;
  id?: string;
  message: string;
}

export type GoldenLoadResult<I, E> =
  | { ok: true; cases: readonly GoldenCase<I, E>[] }
  | { ok: false; issues: readonly GoldenIssue[] };

/** Ruta del golden set de una tarea. */
export function goldenPath(evalsDir: string, taskName: string): string {
  return join(evalsDir, taskName, GOLDEN_FILE_NAME);
}

/** Valida el contenido de un `golden.jsonl`. Ignora líneas en blanco; admite finales de línea LF y CRLF. */
export function parseGolden<I, O, E>(
  evaluable: EvaluableTask<I, O, E>,
  content: string,
): GoldenLoadResult<I, E> {
  const issues: GoldenIssue[] = [];
  const cases: GoldenCase<I, E>[] = [];
  const lineById = new Map<string, number>();
  const caseByKey = new Map<string, GoldenCase<I, E>>();

  content.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (raw.trim() === '') return;

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      issues.push({ line, message: 'line is not valid JSON' });
      return;
    }

    const shape = goldenLineSchema.safeParse(data);
    if (!shape.success) {
      issues.push({
        line,
        ...idOf(data),
        message: `invalid case: ${describeIssues(shape.error)}`,
      });
      return;
    }
    const { id, tags, outputLanguage } = shape.data;

    const firstLine = lineById.get(id);
    if (firstLine !== undefined) {
      issues.push({
        line,
        id,
        message: `duplicated id (first seen on line ${String(firstLine)})`,
      });
      return;
    }
    lineById.set(id, line);

    const input = evaluable.task.inputSchema.safeParse(shape.data.input);
    const expected = evaluable.expectedSchema.safeParse(shape.data.expected);
    if (!input.success) {
      issues.push({
        line,
        id,
        message: `invalid input for task ${evaluable.task.name}: ${describeIssues(input.error)}`,
      });
    }
    if (!expected.success) {
      issues.push({
        line,
        id,
        message: `invalid expected: ${describeIssues(expected.error)}`,
      });
    }
    if (!input.success || !expected.success) return;

    const key = executionKey({
      taskName: evaluable.task.name,
      promptVersion: evaluable.task.promptVersion,
      outputLanguage: outputLanguageOf({ outputLanguage }),
      input: input.data,
    });
    const goldenCase: GoldenCase<I, E> = {
      line,
      id,
      input: input.data,
      expected: expected.data,
      tags,
      ...(outputLanguage === undefined ? {} : { outputLanguage }),
      key,
    };

    const sameKey = caseByKey.get(key);
    if (sameKey !== undefined) {
      issues.push({
        line,
        id,
        message: `same execution key as case "${sameKey.id}" (line ${String(sameKey.line)}): same input and output language`,
      });
      return;
    }
    caseByKey.set(key, goldenCase);
    cases.push(goldenCase);
  });

  if (issues.length === 0 && cases.length === 0) {
    issues.push({ message: 'golden set has no cases' });
  }
  return issues.length === 0 ? { ok: true, cases } : { ok: false, issues };
}

/** Lee y valida `<evalsDir>/<task>/golden.jsonl`. */
export async function loadGolden<I, O, E>(
  evaluable: EvaluableTask<I, O, E>,
  evalsDir: string,
): Promise<GoldenLoadResult<I, E>> {
  const path = goldenPath(evalsDir, evaluable.task.name);
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch {
    return {
      ok: false,
      issues: [{ message: `golden set not readable: ${path}` }],
    };
  }
  return parseGolden(evaluable, content);
}

/** Una línea por problema: `line 3 (id "es-01"): mensaje`. */
export function formatGoldenIssues(
  taskName: string,
  issues: readonly GoldenIssue[],
): string {
  const lines = issues.map((issue) => {
    const where = [
      issue.line === undefined ? null : `line ${String(issue.line)}`,
      issue.id === undefined ? null : `id "${issue.id}"`,
    ].filter((part): part is string => part !== null);
    return `  - ${where.length === 0 ? '' : `${where.join(', ')}: `}${issue.message}`;
  });
  return `Invalid golden set for task ${taskName}:\n${lines.join('\n')}\n`;
}

function idOf(data: unknown): { id?: string } {
  if (data !== null && typeof data === 'object' && 'id' in data) {
    const { id } = data;
    if (typeof id === 'string' && id.length > 0) return { id };
  }
  return {};
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}
