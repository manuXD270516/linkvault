import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RunTaskFn } from '../../application/run-task.usecase';
import type { AiResult } from '../../domain/ai-result';
import { AiProgrammingError } from '../../domain/errors';
import type { UsageRecord } from '../../domain/ports/usage-ledger.port';
import type { AiProviderId } from '../../infrastructure/config/ai-config.schema';
import type { MockFixture } from '../../infrastructure/providers/mock-deterministic.provider';
import type { EvaluableTask, GoldenCase } from '../evaluable-task';
import type { EvalUsageLedger } from '../runner/eval-ports';
import { caseContext, EvalCaseProgrammingError } from '../runner/run-cases';

// Grabación de fixtures con un proveedor real (D7 de ai-eval-harness, ADR-019 §5; requisito "Grabación de fixtures con
// un proveedor real"). Ejecuta cada caso del golden con el `RunTask` compuesto para el upstream y el contexto por defecto
// del corredor, y solo en `success` escribe `<fixturesDir>/<task>/<key>.json` con la salida validada y reinyectada. La
// redacción hacia upstreams externos la aplica `runTask`. Nunca escribe el input ni el prompt.

/** Proveedor real contra el que se graba: cualquiera salvo el mock. */
export type RecordingUpstream = Exclude<AiProviderId, 'mock'>;

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
 */
export async function recordFixtures<I, O, E>(
  options: RecordFixturesOptions<I, O, E>,
): Promise<RecordFixturesSummary> {
  const { evaluable, runTask, ledger, fixturesDir, upstream, overwrite } =
    options;
  const { task } = evaluable;
  const recorded: string[] = [];
  const skipped: string[] = [];
  const failed: RecordingFailure[] = [];

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
    // `runTask` registra de forma síncrona antes de resolver: aquí ya están todos los registros de la clave.
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
