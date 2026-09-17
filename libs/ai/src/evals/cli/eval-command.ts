import { readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AiConfig } from '../../infrastructure/config/ai-config.schema';
import {
  formatAiConfigProblems,
  type AiEnv,
} from '../../infrastructure/config/parse-ai-config';
import type {
  AnyEvaluableTask,
  CaseResult,
  GoldenCase,
} from '../evaluable-task';
import { EVALUABLE_TASKS } from '../evaluable-tasks';
import {
  formatGoldenIssues,
  GOLDEN_FILE_NAME,
  loadGolden,
} from '../golden.schema';
import { computeMetrics } from '../metrics/aggregate';
import type { MetricValue } from '../metrics/metric';
import {
  buildBaseline,
  checkOrUpdateBaseline,
  formatBaselineProblems,
} from '../runner/baseline';
import {
  composeEvalRunTask,
  type EvalRunTaskComposition,
} from '../runner/compose-run-task';
import { StderrAiLogger, type TextWriter } from '../runner/eval-ports';
import {
  formatNumber,
  renderReport,
  reportModel,
  writeReport,
} from '../runner/report';
import {
  countCases,
  EvalCaseProgrammingError,
  runCases,
} from '../runner/run-cases';
import {
  EXIT_CODES,
  parseEvalArgs,
  type EvalArgs,
  type ExitCode,
} from './args';

// Comando `nx run ai:eval` (D2, D3, D5 y D6 de ai-eval-harness; requisito "Corredor de evaluación"). Sin efectos sobre
// el proceso: recibe entorno, directorio de trabajo y salidas, y devuelve el código de salida. `eval.ts` lo conecta a
// `process`.
//
// Orden: argumentos → tareas → golden sets de todas las tareas → composición de `RunTask` (nada de esto contacta a un
// proveedor) → por tarea, casos, métricas, reporte y, con mock, línea base. Código final: el máximo de las tareas; un
// error de programación detiene la evaluación con 3.

export interface CliIo {
  env: AiEnv;
  cwd: string;
  stdout: TextWriter;
  stderr: TextWriter;
  now(): Date;
}

export interface EvalCommandOptions {
  /** Registro de tareas evaluables; por defecto `EVALUABLE_TASKS`. */
  tasks?: readonly AnyEvaluableTask[];
}

interface LoadedTask {
  evaluable: AnyEvaluableTask;
  cases: readonly GoldenCase<unknown, unknown>[];
}

export async function runEvalCommand(
  argv: readonly string[],
  io: CliIo,
  options: EvalCommandOptions = {},
): Promise<ExitCode> {
  const registry = options.tasks ?? EVALUABLE_TASKS;
  const parsed = parseEvalArgs(argv);
  if (!parsed.ok) {
    io.stderr(`${parsed.message}\n`);
    return EXIT_CODES.usage;
  }
  const args = parsed.args;

  const selected = selectTasks(args, registry);
  if (!selected.ok) {
    io.stderr(`${selected.message}\n`);
    return EXIT_CODES.usage;
  }

  const evalsDir = resolve(io.cwd, args.evalsDir);
  const reportsDir = resolve(io.cwd, args.reportsDir);

  // Golden sets inválidos: código 2 antes de ejecutar ningún caso de ninguna tarea.
  const loaded: LoadedTask[] = [];
  let goldenInvalid = false;
  for (const evaluable of selected.tasks) {
    const golden = await loadGolden(evaluable, evalsDir);
    if (golden.ok) {
      loaded.push({ evaluable, cases: golden.cases });
    } else {
      goldenInvalid = true;
      io.stderr(formatGoldenIssues(evaluable.task.name, golden.issues));
    }
  }
  if (goldenInvalid) return EXIT_CODES.usage;

  const composed = composeEvalRunTask({
    env: io.env,
    provider: args.provider,
    allowExternal: args.allowExternal,
    ...(args.ollamaUrl === undefined ? {} : { ollamaUrl: args.ollamaUrl }),
    ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
    tasks: registry.map((evaluable) => evaluable.task),
    cwd: io.cwd,
    logger: new StderrAiLogger(io.stderr),
  });
  if (!composed.ok) {
    const { error } = composed;
    io.stderr(
      error.kind === 'invalid_config'
        ? formatAiConfigProblems('ai:eval', error.problems)
        : `[ai:eval] Provider ${error.providerId} is external: pass --allow-external to send the golden set to it\n`,
    );
    return EXIT_CODES.usage;
  }

  let exitCode: ExitCode = EXIT_CODES.success;
  for (const task of loaded) {
    const code = await evaluateTask(task, args, composed.value, {
      io,
      evalsDir,
      reportsDir,
    });
    exitCode = Math.max(exitCode, code) as ExitCode;
    if (code === EXIT_CODES.programming) break;
  }
  return exitCode;
}

async function evaluateTask(
  { evaluable, cases }: LoadedTask,
  args: EvalArgs,
  composition: EvalRunTaskComposition,
  paths: { io: CliIo; evalsDir: string; reportsDir: string },
): Promise<ExitCode> {
  const { io } = paths;
  const taskName = evaluable.task.name;

  let results: CaseResult<unknown, unknown, unknown>[];
  try {
    results = await runCases({
      evaluable,
      cases,
      runTask: composition.runTask.execute,
      ledger: composition.ledger,
      clock: composition.clock,
    });
  } catch (error) {
    if (error instanceof EvalCaseProgrammingError) {
      io.stderr(`[ai:eval] ${error.message}\n`);
      return EXIT_CODES.programming;
    }
    throw error;
  }

  const metrics = computeMetrics(evaluable, results);
  let exitCode: ExitCode = EXIT_CODES.success;
  let baselineColumn: Readonly<Record<string, number>> | null | undefined;
  const baselineMessages: string[] = [];

  // Con proveedores reales la línea base ni se compara ni se modifica.
  if (args.provider === 'mock') {
    const current = buildBaseline({
      taskName,
      promptVersion: evaluable.task.promptVersion,
      cases,
      metrics,
    });
    const check = await checkOrUpdateBaseline({
      evalsDir: paths.evalsDir,
      current,
      metrics,
      update: args.updateBaseline,
    });
    switch (check.status) {
      case 'updated':
        baselineColumn = check.baseline.metrics;
        baselineMessages.push(`baseline updated: ${check.path}`);
        break;
      case 'matches':
        baselineColumn = check.stored.metrics;
        break;
      case 'differs':
        baselineColumn =
          check.stored.status === 'found'
            ? check.stored.baseline.metrics
            : null;
        exitCode = EXIT_CODES.regression;
        for (const message of formatBaselineProblems(
          taskName,
          check.problems,
        )) {
          io.stderr(`${message}
`);
        }
        break;
    }
  }

  const markdown = renderReport({
    evaluable,
    providerId: args.provider,
    model: reportModel(results, configuredModel(composition.config)),
    generatedAt: io.now(),
    metrics,
    ...(baselineColumn === undefined ? {} : { baseline: baselineColumn }),
    results,
  });
  const reportPath = await writeReport(
    paths.reportsDir,
    taskName,
    args.provider,
    markdown,
  );

  io.stdout(summary(taskName, args.provider, results, metrics));
  for (const message of baselineMessages) io.stdout(`  ${message}\n`);
  io.stdout(`  report: ${reportPath}\n`);
  return exitCode;
}

type TaskSelection =
  | { ok: true; tasks: readonly AnyEvaluableTask[] }
  | { ok: false; message: string };

function selectTasks(
  args: EvalArgs,
  registry: readonly AnyEvaluableTask[],
): TaskSelection {
  if (args.all) return { ok: true, tasks: registry };
  const evaluable = registry.find((e) => e.task.name === args.task);
  if (evaluable !== undefined) return { ok: true, tasks: [evaluable] };
  const names = registry.map((e) => e.task.name).join(', ');
  const shown = /^[a-z0-9][a-z0-9-]{0,39}$/.test(args.task ?? '')
    ? `"${args.task ?? ''}"`
    : '(unprintable)';
  return {
    ok: false,
    message: `[ai:eval] Unknown task ${shown}. Evaluable tasks: ${names || '(none)'}`,
  };
}

function configuredModel(config: AiConfig): string | undefined {
  return config.ollama?.model ?? config.openrouter?.model;
}

function summary(
  taskName: string,
  provider: string,
  results: readonly CaseResult<unknown, unknown, unknown>[],
  metrics: readonly MetricValue[],
): string {
  const counts = countCases(results);
  const values = metrics
    .map((metric) => `${metric.name}=${formatNumber(metric.value)}`)
    .join(' ');
  return (
    `${taskName} [${provider}]: ${String(counts.total)} cases, ${String(counts.success)} success, ` +
    `${String(counts.degraded)} degraded, ${String(counts.providerErrors)} provider errors\n  ${values}\n`
  );
}

/**
 * Tareas con golden set: subdirectorios de `evalsDir` que contienen `golden.jsonl`, ordenados. Para comprobar la
 * coherencia entre registro y golden sets (ADR-019 §2).
 */
export async function goldenTaskDirs(evalsDir: string): Promise<string[]> {
  const entries = await readdir(evalsDir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const golden = await stat(
      join(evalsDir, entry.name, GOLDEN_FILE_NAME),
    ).catch(() => null);
    if (golden?.isFile() === true) names.push(entry.name);
  }
  return names.sort();
}

export interface RegistryCoherence {
  /** Tareas registradas sin `golden.jsonl`. */
  withoutGolden: string[];
  /** Directorios con `golden.jsonl` sin tarea registrada. */
  unregistered: string[];
}

export async function registryCoherence(
  evalsDir: string,
  registry: readonly AnyEvaluableTask[] = EVALUABLE_TASKS,
): Promise<RegistryCoherence> {
  const golden = new Set(await goldenTaskDirs(evalsDir));
  const registered = new Set<string>(registry.map((e) => e.task.name));
  return {
    withoutGolden: [...registered].filter((name) => !golden.has(name)).sort(),
    unregistered: [...golden].filter((name) => !registered.has(name)).sort(),
  };
}
