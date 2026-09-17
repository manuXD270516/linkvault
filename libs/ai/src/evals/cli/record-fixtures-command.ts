import { isAbsolute, resolve } from 'node:path';
import { AI_CONFIG_DEFAULTS } from '../../infrastructure/config/ai-config.schema';
import { formatAiConfigProblems } from '../../infrastructure/config/parse-ai-config';
import type { AnyEvaluableTask } from '../evaluable-task';
import { EVALUABLE_TASKS } from '../evaluable-tasks';
import { formatGoldenIssues, loadGolden } from '../golden.schema';
import {
  recordFixtures,
  type RecordFixturesSummary,
} from '../recording/record-fixtures';
import { composeEvalRunTask } from '../runner/compose-run-task';
import { StderrAiLogger } from '../runner/eval-ports';
import { EvalCaseProgrammingError } from '../runner/run-cases';
import { EXIT_CODES, parseRecordFixturesArgs, type ExitCode } from './args';
import type { CliIo } from './eval-command';

// Comando `nx run ai:record-fixtures` (D2, D6 y D7 de ai-eval-harness; ADR-019 §5). Sin efectos sobre el proceso: recibe
// entorno, directorio de trabajo y salidas, y devuelve el código de salida. `record-fixtures.ts` lo conecta a `process`.
//
// Orden: argumentos → rechazo en producción → tarea → golden set → composición de `RunTask` con el upstream (nada de esto
// contacta a un proveedor) → grabación. Código 1 si algún caso no se grabó; 3 ante un error de programación.

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

  const evaluable = registry.find((e) => e.task.name === args.task);
  if (evaluable === undefined) {
    const shown = /^[a-z0-9][a-z0-9-]{0,39}$/.test(args.task)
      ? `"${args.task}"`
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

  const composed = composeEvalRunTask({
    env: io.env,
    provider: args.upstream,
    allowExternal: args.allowExternal,
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
    return EXIT_CODES.usage;
  }

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
