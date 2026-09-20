import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PiiRedactor } from '../../application/pii-redactor';
import type { RunTaskFn } from '../../application/run-task.usecase';
import type { AiResult } from '../../domain/ai-result';
import { AiProgrammingError } from '../../domain/errors';
import type { UsageRecord } from '../../domain/ports/usage-ledger.port';
import type { MockFixture } from '../../infrastructure/providers/mock-deterministic.provider';
import type { RecordingUpstream } from '../cli/args';
import type { EvaluableTask, GoldenCase } from '../evaluable-task';
import type { EvalUsageLedger } from '../runner/eval-ports';
import { caseContext, EvalCaseProgrammingError } from '../runner/run-cases';

// Grabación de fixtures (D7 de ai-eval-harness, ADR-019 §5; cv-match-suggestions 6.14–6.15). Ejecuta cada caso del
// golden con el `RunTask` compuesto para el upstream. Una tarea `personal` solo se graba contra el mock; lo escrito a
// disco debe quedar limpio frente al redactor externo (sin valores reinyectados que el detector capturaría).

export interface RecordFixturesOptions<I, O, E> {
  evaluable: EvaluableTask<I, O, E>;
  cases: readonly GoldenCase<I, E>[];
  /** `RunTask` compuesto con `AI_CHAIN=<upstream>` (`composeEvalRunTask`). */
  runTask: RunTaskFn;
  /** El ledger que recibe `runTask`: de él salen los tokens del fixture. */
  ledger: EvalUsageLedger;
  /** `AI_FIXTURES_DIR` efectivo: contiene `<task>/<key>.json`. */
  fixturesDir: string;
  upstream: RecordingUpstream;
  /** `--overwrite`: vuelve a grabar los casos que ya tienen fixture. */
  overwrite: boolean;
}

export interface RecordingFailure {
  id: string;
  /** Motivo sin valores del caso: estado, razón de degradación y resultados del ledger. */
  reason: string;
}

export interface RecordFixturesSummary {
  /** `id` de los casos grabados, en orden de archivo. */
  recorded: readonly string[];
  /** `id` de los casos omitidos por tener ya fixture (sin `overwrite`). */
  skipped: readonly string[];
  /** Casos no grabados: el CLI termina con código 1 si hay alguno. */
  failed: readonly RecordingFailure[];
}

/** Rechazo temprano: tarea `personal` contra un upstream que no es el mock (código 2). */
export class PersonalTaskUpstreamRejected extends Error {
  override readonly name = 'PersonalTaskUpstreamRejected';

  constructor(
    readonly taskName: string,
    readonly sensitivity: string,
    readonly upstream: string,
  ) {
    super(
      `task ${taskName} is ${sensitivity}: recording against upstream ${upstream} is not allowed (use --upstream=mock)`,
    );
  }
}

/** Ruta del fixture de replay de un caso (la misma que lee `MockDeterministicProvider`). */
export function fixturePath(
  fixturesDir: string,
  taskName: string,
  key: string,
): string {
  return join(fixturesDir, taskName, `${key}.json`);
}

/**
 * Graba en secuencia y en orden de archivo. Lanza `EvalCaseProgrammingError` si un caso provoca un `AiProgrammingError`
 * (se detiene la grabación); cualquier otro resultado distinto de `success` se lista en `failed` sin escribir nada.
 * Lanza `PersonalTaskUpstreamRejected` antes de contactar a nadie si la tarea es `personal` y el upstream no es mock.
 */
export async function recordFixtures<I, O, E>(
  options: RecordFixturesOptions<I, O, E>,
): Promise<RecordFixturesSummary> {
  const { evaluable, runTask, ledger, fixturesDir, upstream, overwrite } =
    options;
  const { task } = evaluable;

  if (task.dataSensitivity === 'personal' && upstream !== 'mock') {
    throw new PersonalTaskUpstreamRejected(
      task.name,
      task.dataSensitivity,
      upstream,
    );
  }

  const recorded: string[] = [];
  const skipped: string[] = [];
  const failed: RecordingFailure[] = [];
  const redactor = new PiiRedactor();

  for (const goldenCase of options.cases) {
    const path = fixturePath(fixturesDir, task.name, goldenCase.key);
    if (!overwrite && (await exists(path))) {
      skipped.push(goldenCase.id);
      continue;
    }

    let result: AiResult<O>;
    try {
      result = await runTask(task, goldenCase.input, caseContext(goldenCase));
    } catch (error) {
      ledger.take(goldenCase.key);
      if (error instanceof AiProgrammingError) {
        throw new EvalCaseProgrammingError(
          task.name,
          goldenCase.id,
          goldenCase.key,
          error,
        );
      }
      throw error;
    }
    const records = ledger.take(goldenCase.key);
    const outcomes = records.map((entry) => entry.outcome).join(', ');

    if (result.status !== 'success') {
      failed.push({
        id: goldenCase.id,
        reason: `degraded (${result.reason}); ledger outcomes: [${outcomes}]`,
      });
      continue;
    }
    if (result.providerId !== upstream) {
      failed.push({
        id: goldenCase.id,
        reason: `success from provider ${result.providerId}, expected upstream ${upstream}`,
      });
      continue;
    }

    if (task.dataSensitivity === 'personal') {
      const dirty = personalFixturePiiTypes(result.output, redactor);
      if (dirty.length > 0) {
        failed.push({
          id: goldenCase.id,
          reason: `personal fixture would retain pii type ${dirty[0] ?? 'unknown'} after external redaction`,
        });
        continue;
      }
    }

    const usage = successUsage(records);
    const fixture: MockFixture = {
      source: `recorded:${upstream}:${result.model}`,
      text: JSON.stringify(result.output),
      model: result.model,
      usage,
    };
    await mkdir(join(fixturesDir, task.name), { recursive: true });
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
    recorded.push(goldenCase.id);
  }

  return { recorded, skipped, failed };
}

/**
 * Tipos de PII que el redactor externo sustituiría en la salida (marcadores emitidos). Vacío = limpio para disco.
 * Nunca expone el valor.
 */
export function personalFixturePiiTypes(
  output: unknown,
  redactor: PiiRedactor = new PiiRedactor(),
): readonly string[] {
  const { emittedMarkers, value } = redactor.redact(output, {
    redactName: true,
  });
  if (stableJson(value) === stableJson(output) && emittedMarkers.size === 0) {
    return [];
  }
  const types = new Set<string>();
  for (const marker of emittedMarkers) {
    const match = /^\[([A-Z]+)_/u.exec(marker);
    if (match?.[1] !== undefined) types.add(match[1].toLowerCase());
  }
  // Si cambió el valor sin emitir (p. ej. comparación), reportar un tipo genérico no expuesto.
  if (types.size === 0 && stableJson(value) !== stableJson(output)) {
    types.add('unknown');
  }
  return [...types].sort();
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Tokens del registro `success`: los de la respuesta (con su reparación, si la hubo) que produjo la salida grabada. */
function successUsage(records: readonly UsageRecord[]): MockFixture['usage'] {
  const success = records.find((entry) => entry.outcome === 'success');
  return {
    inputTokens: success?.inputTokens ?? 0,
    outputTokens: success?.outputTokens ?? 0,
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
