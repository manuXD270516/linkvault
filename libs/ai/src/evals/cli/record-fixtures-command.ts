import { isAbsolute, resolve } from 'node:path';
import {
  PENDING_FIXTURES_DEFAULT_PATH,
  PENDING_FIXTURES_FILE_VAR,
  readPendingFixtures,
  type PendingFixture,
} from '../../application/pending-fixtures';
import { AI_CONFIG_DEFAULTS } from '../../infrastructure/config/ai-config.schema';
import { formatAiConfigProblems } from '../../infrastructure/config/parse-ai-config';
import type { AnyEvaluableTask } from '../evaluable-task';
import { EVALUABLE_TASKS } from '../evaluable-tasks';
import { formatGoldenIssues, loadGolden } from '../golden.schema';
import { pendingCases, type PendingSkip } from '../recording/pending-cases';
import {
  recordFixtures,
  PersonalTaskUpstreamRejected,
  type RecordFixturesSummary,
} from '../recording/record-fixtures';
import { composeEvalRunTask } from '../runner/compose-run-task';
import { StderrAiLogger } from '../runner/eval-ports';
import { EvalCaseProgrammingError } from '../runner/run-cases';
import {
  EXIT_CODES,
  parseRecordFixturesArgs,
  type ExitCode,
  type RecordFixturesArgs,
} from './args';
import type { CliIo } from './eval-command';

// Comando `nx run ai:record-fixtures` (D2, D6 y D7 de ai-eval-harness; ADR-019 §5). Sin efectos sobre el proceso: recibe
// entorno, directorio de trabajo y salidas, y devuelve el código de salida. `record-fixtures.ts` lo conecta a `process`.
//
// Orden: argumentos → rechazo en producción → tarea → golden set → composición de `RunTask` con el upstream (nada de esto
// contacta a un proveedor) → grabación. Código 1 si algún caso no se grabó; 3 ante un error de programación.
//
// Con `--from-pending` los casos no salen del golden sino del registro que `runTask` escribe durante los tests (4.6 y
// 4.7 de link-enrichment): misma grabación, otro origen. Las entradas que no se pueden grabar —las de una tarea
// `personal`, que nunca llevan su entrada, y las que quedaron obsoletas— se listan con su motivo y no hacen fallar el
// comando: no hay nada que reintentar en ellas.

export interface RecordFixturesCommandOptions {
  /** Registro de tareas evaluables; por defecto `EVALUABLE_TASKS`. */
  tasks?: readonly AnyEvaluableTask[];
}

export async function runRecordFixturesCommand(
  argv: readonly string[],
  io: CliIo,
  options: RecordFixturesCommandOptions = {},
): Promise<ExitCode> {
  const registry = options.tasks ?? EVALUABLE_TASKS;
  const parsed = parseRecordFixturesArgs(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.message}\n`);
    return EXIT_CODES.usage;
  }
  const args = parsed.args;

  if (io.env['NODE_ENV'] === 'production') {
    io.stderr(
      '[ai:record-fixtures] Recording fixtures is not allowed with NODE_ENV=production\n',
    );
    return EXIT_CODES.usage;
  }

  if (args.fromPending) {
    return recordFromPending(args, io, registry);
  }

  // Sin `--from-pending` el parseo garantiza `--task`; el `??` solo evita arrastrar un tipo opcional hasta aquí.
  const taskName = args.task ?? '';
  const evaluable = registry.find((e) => e.task.name === taskName);
  if (evaluable === undefined) {
    const shown = /^[a-z0-9][a-z0-9-]{0,39}$/.test(taskName)
      ? `"${taskName}"`
      : '(unprintable)';
    const names = registry.map((e) => e.task.name).join(', ');
    io.stderr(
      `[ai:record-fixtures] Unknown task ${shown}. Evaluable tasks: ${names || '(none)'}\n`,
    );
    return EXIT_CODES.usage;
  }

  const golden = await loadGolden(evaluable, resolve(io.cwd, args.evalsDir));
  if (!golden.ok) {
    io.stderr(formatGoldenIssues(evaluable.task.name, golden.issues));
    return EXIT_CODES.usage;
  }

  const composed = composeUpstream(args, io, registry);
  if (!composed.ok) return EXIT_CODES.usage;

  const fixturesDir = fixturesDirOf(io);
  let summary: RecordFixturesSummary;
  try {
    summary = await recordFixtures({
      evaluable,
      cases: golden.cases,
      runTask: composed.value.runTask.execute,
      ledger: composed.value.ledger,
      fixturesDir,
      upstream: args.upstream,
      overwrite: args.overwrite,
    });
  } catch (error) {
    if (error instanceof PersonalTaskUpstreamRejected) {
      io.stderr(`[ai:record-fixtures] ${error.message}\n`);
      return EXIT_CODES.usage;
    }
    if (error instanceof EvalCaseProgrammingError) {
      io.stderr(`[ai:record-fixtures] ${error.message}\n`);
      return EXIT_CODES.programming;
    }
    throw error;
  }

  io.stdout(
    formatSummary(evaluable.task.name, args.upstream, fixturesDir, summary),
  );
  return summary.failed.length > 0 ? EXIT_CODES.regression : EXIT_CODES.success;
}

/**
 * `AI_FIXTURES_DIR` efectivo: con un upstream real `AiConfig` no trae `mock.fixturesDir`, así que se resuelve igual que
 * `parseMock`: la variable (vacía cuenta como ausente) o el valor por defecto, contra el directorio de trabajo.
 */
export function fixturesDirOf(io: Pick<CliIo, 'env' | 'cwd'>): string {
  const raw = io.env['AI_FIXTURES_DIR'];
  const path =
    raw === undefined || raw === '' ? AI_CONFIG_DEFAULTS.AI_FIXTURES_DIR : raw;
  return isAbsolute(path) ? path : resolve(io.cwd, path);
}

function formatSummary(
  taskName: string,
  upstream: string,
  fixturesDir: string,
  summary: RecordFixturesSummary,
): string {
  const lines = [
    `${taskName} [${upstream}]: ${String(summary.recorded.length)} recorded, ${String(summary.skipped.length)} skipped, ${String(summary.failed.length)} failed`,
    `  fixtures: ${fixturesDir}`,
  ];
  if (summary.recorded.length > 0) {
    lines.push(`  recorded: ${summary.recorded.join(', ')}`);
  }
  if (summary.skipped.length > 0) {
    lines.push(
      `  skipped (fixture exists, use --overwrite): ${summary.skipped.join(', ')}`,
    );
  }
  for (const failure of summary.failed) {
    lines.push(`  failed ${failure.id}: ${failure.reason}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Graba lo que los tests anotaron (4.7). Las entradas no grabables no hacen fallar el comando: se dicen y ya, porque
 * volver a intentarlas no cambiaría nada.
 */
async function recordFromPending(
  args: RecordFixturesArgs,
  io: CliIo,
  registry: readonly AnyEvaluableTask[],
): Promise<ExitCode> {
  const path = pendingFileOf(io, args);
  const entries = readPendingFixtures(path).filter(
    (entry: PendingFixture) =>
      args.task === undefined || entry.task === args.task,
  );
  if (entries.length === 0) {
    io.stdout(`[ai:record-fixtures] no pending entries in ${path}\n`);
    return EXIT_CODES.success;
  }

  const { groups, skipped } = pendingCases(entries, registry);
  const composed = composeUpstream(args, io, registry);
  if (!composed.ok) return EXIT_CODES.usage;

  const fixturesDir = fixturesDirOf(io);
  const blocks = [
    `pending [${args.upstream}]: ${String(entries.length)} annotated entries from ${path}\n`,
  ];
  let failed = 0;
  for (const group of groups) {
    let summary: RecordFixturesSummary;
    try {
      summary = await recordFixtures({
        evaluable: group.evaluable,
        cases: group.cases,
        runTask: composed.value.runTask.execute,
        ledger: composed.value.ledger,
        fixturesDir,
        upstream: args.upstream,
        overwrite: args.overwrite,
      });
    } catch (error) {
      if (error instanceof EvalCaseProgrammingError) {
        io.stdout(blocks.join(''));
        io.stderr(`[ai:record-fixtures] ${error.message}\n`);
        return EXIT_CODES.programming;
      }
      throw error;
    }
    failed += summary.failed.length;
    blocks.push(
      formatSummary(
        group.evaluable.task.name,
        args.upstream,
        fixturesDir,
        summary,
      ),
    );
  }
  blocks.push(formatSkipped(skipped));
  io.stdout(blocks.join(''));
  return failed > 0 ? EXIT_CODES.regression : EXIT_CODES.success;
}

/** Composición del upstream, con su error ya escrito en stderr. */
function composeUpstream(
  args: RecordFixturesArgs,
  io: CliIo,
  registry: readonly AnyEvaluableTask[],
): ReturnType<typeof composeEvalRunTask> {
  const composed = composeEvalRunTask({
    env: io.env,
    provider: args.upstream,
    allowExternal: args.allowExternal,
    ...(args.upstream === 'mock' ? { mockMode: 'synth' as const } : {}),
    ...(args.ollamaUrl === undefined ? {} : { ollamaUrl: args.ollamaUrl }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    tasks: registry.map((e) => e.task),
    cwd: io.cwd,
    logger: new StderrAiLogger(io.stderr),
  });
  if (!composed.ok) {
    const { error } = composed;
    io.stderr(
      error.kind === 'invalid_config'
        ? formatAiConfigProblems('ai:record-fixtures', error.problems)
        : `[ai:record-fixtures] Upstream ${error.providerId} is external: pass --allow-external to send the golden set to it\n`,
    );
  }
  return composed;
}

/**
 * Registro de entradas pendientes: `--pending-file`, `AI_PENDING_FIXTURES_FILE` o el valor por defecto, resuelto contra
 * el directorio de trabajo.
 */
export function pendingFileOf(
  io: Pick<CliIo, 'env' | 'cwd'>,
  args: Pick<RecordFixturesArgs, 'pendingFile'>,
): string {
  const configured = args.pendingFile ?? io.env[PENDING_FIXTURES_FILE_VAR];
  const path =
    configured === undefined || configured === ''
      ? PENDING_FIXTURES_DEFAULT_PATH
      : configured;
  return isAbsolute(path) ? path : resolve(io.cwd, path);
}

function formatSkipped(skipped: readonly PendingSkip[]): string {
  return skipped
    .map(
      (skip) =>
        `  not recordable ${skip.task}:${skip.key.slice(0, 12)}: ${skip.reason}\n`,
    )
    .join('');
}
