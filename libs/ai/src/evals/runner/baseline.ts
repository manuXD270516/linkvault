import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { canonicalJSON } from '../../application/canonical-json';
import type { GoldenCase } from '../evaluable-task';
import { PII_LEAK_RATE } from '../metrics/redaction-metrics';
import type { MetricValue } from '../metrics/metric';

// Línea base estricta en replay (D5 de ai-eval-harness, ADR-019 §4, requisito "Línea base estricta en replay"): versión
// de prompt, hash del golden sobre los casos parseados y métricas bloqueantes. Cualquier diferencia falla, empeore o
// mejore; `--update-baseline` la reescribe a propósito.

export const BASELINE_FILE_NAME = 'baseline.json';

/** Diferencia máxima admitida entre el valor actual y el de la línea base. */
export const METRIC_TOLERANCE = 1e-9;

export const baselineSchema = z.strictObject({
  task: z.string().min(1),
  promptVersion: z.string().min(1),
  goldenSha256: z.string().regex(/^[0-9a-f]{64}$/),
  metrics: z.record(z.string(), z.number()),
});

export type Baseline = z.infer<typeof baselineSchema>;

export type StoredBaseline =
  | { status: 'missing' }
  | { status: 'invalid' }
  | { status: 'found'; baseline: Baseline };

export type BaselineProblem =
  | { kind: 'missing' }
  | { kind: 'invalid' }
  | { kind: 'prompt_changed'; baseline: string; current: string }
  | { kind: 'golden_changed' }
  | { kind: 'schema_validity_below_one'; current: number }
  | { kind: 'pii_leak_hard_floor'; current: number; caseIds: readonly string[] }
  | {
      kind: 'worsened' | 'improved';
      metric: string;
      baseline: number;
      current: number;
    }
  | { kind: 'metric_added'; metric: string; current: number }
  | { kind: 'metric_removed'; metric: string; baseline: number };

export interface BaselineComparison {
  ok: boolean;
  problems: readonly BaselineProblem[];
}

/** Ruta de la línea base de una tarea. */
export function baselinePath(evalsDir: string, taskName: string): string {
  return join(evalsDir, taskName, BASELINE_FILE_NAME);
}

/**
 * SHA-256 del JSON canónico (ADR-018 §3) de los casos parseados: `id`, `input`, `expected`, `tags` y `outputLanguage`,
 * en orden de archivo. No depende de finales de línea, espacios, orden de claves ni líneas en blanco.
 */
export function goldenSha256(
  cases: readonly GoldenCase<unknown, unknown>[],
): string {
  const canonical = canonicalJSON(
    cases.map(({ id, input, expected, tags, outputLanguage }) => ({
      id,
      input,
      expected,
      tags,
      outputLanguage,
    })),
  );
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Línea base del resultado actual: solo métricas bloqueantes, con claves ordenadas. */
export function buildBaseline(options: {
  taskName: string;
  promptVersion: string;
  cases: readonly GoldenCase<unknown, unknown>[];
  metrics: readonly MetricValue[];
}): Baseline {
  const blocking = options.metrics
    .filter((metric) => metric.kind === 'blocking')
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return {
    task: options.taskName,
    promptVersion: options.promptVersion,
    goldenSha256: goldenSha256(options.cases),
    metrics: Object.fromEntries(blocking.map((m) => [m.name, m.value])),
  };
}

/** JSON estable: claves de `metrics` ordenadas, 2 espacios y salto de línea final. */
export function serializeBaseline(baseline: Baseline): string {
  const metrics = Object.fromEntries(
    Object.keys(baseline.metrics)
      .sort()
      .map((name) => [name, baseline.metrics[name]]),
  );
  return `${JSON.stringify(
    {
      task: baseline.task,
      promptVersion: baseline.promptVersion,
      goldenSha256: baseline.goldenSha256,
      metrics,
    },
    null,
    2,
  )}\n`;
}

export async function readBaseline(
  evalsDir: string,
  taskName: string,
): Promise<StoredBaseline> {
  let raw: string;
  try {
    raw = await readFile(baselinePath(evalsDir, taskName), 'utf8');
  } catch (error) {
    if (isNotFound(error)) return { status: 'missing' };
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'invalid' };
  }
  const parsed = baselineSchema.safeParse(data);
  if (!parsed.success || parsed.data.task !== taskName) {
    return { status: 'invalid' };
  }
  return { status: 'found', baseline: parsed.data };
}

/** Escribe la línea base (`--update-baseline`) y devuelve su ruta. */
export async function writeBaseline(
  evalsDir: string,
  baseline: Baseline,
): Promise<string> {
  const path = baselinePath(evalsDir, baseline.task);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeBaseline(baseline), 'utf8');
  return path;
}

/**
 * Compara el resultado actual con la línea base guardada. `current.metrics` lleva las métricas bloqueantes y `metrics`
 * aporta su dirección. Sin línea base, inválida, con otro prompt o con otro golden no se comparan métricas.
 */
export function compareWithBaseline(
  stored: StoredBaseline,
  current: Baseline,
  metrics: readonly MetricValue[],
): BaselineComparison {
  const problems: BaselineProblem[] = [];
  const schemaValidity = current.metrics['schema_validity_rate'];
  const belowOne =
    schemaValidity !== undefined && schemaValidity < 1 - METRIC_TOLERANCE;

  if (stored.status !== 'found') {
    problems.push({ kind: stored.status });
    if (belowOne) {
      problems.push({
        kind: 'schema_validity_below_one',
        current: schemaValidity,
      });
    }
    return { ok: false, problems };
  }

  const { baseline } = stored;
  if (baseline.promptVersion !== current.promptVersion) {
    problems.push({
      kind: 'prompt_changed',
      baseline: baseline.promptVersion,
      current: current.promptVersion,
    });
  }
  if (baseline.goldenSha256 !== current.goldenSha256) {
    problems.push({ kind: 'golden_changed' });
  }
  if (belowOne) {
    problems.push({
      kind: 'schema_validity_below_one',
      current: schemaValidity,
    });
  }
  if (
    problems.some(
      (p) => p.kind === 'prompt_changed' || p.kind === 'golden_changed',
    )
  ) {
    return { ok: false, problems };
  }

  const directions = new Map(metrics.map((m) => [m.name, m.direction]));
  const names = [
    ...new Set([
      ...Object.keys(current.metrics),
      ...Object.keys(baseline.metrics),
    ]),
  ].sort();
  for (const metric of names) {
    const now = current.metrics[metric];
    const before = baseline.metrics[metric];
    if (before === undefined) {
      if (now !== undefined)
        problems.push({ kind: 'metric_added', metric, current: now });
      continue;
    }
    if (now === undefined) {
      problems.push({ kind: 'metric_removed', metric, baseline: before });
      continue;
    }
    if (Math.abs(now - before) <= METRIC_TOLERANCE) continue;
    const higherIsBetter = (directions.get(metric) ?? 'higher') === 'higher';
    const improved = higherIsBetter ? now > before : now < before;
    problems.push({
      kind: improved ? 'improved' : 'worsened',
      metric,
      baseline: before,
      current: now,
    });
  }
  return { ok: problems.length === 0, problems };
}

/** Resultado del paso de línea base; lleva la línea base escrita o leída para la columna del reporte. */
export type BaselineCheck =
  | { status: 'updated'; path: string; baseline: Baseline }
  | { status: 'matches'; stored: Baseline }
  | {
      status: 'differs';
      stored: StoredBaseline;
      problems: readonly BaselineProblem[];
    };

/**
 * Paso de línea base de una evaluación en replay: con `update` reescribe la línea base con el resultado actual; si no,
 * la compara. El CLI traduce `differs` a código 1.
 *
 * `pii_leak_rate > 0` es suelo duro (ADR-030 §2): falla también con `--update-baseline` y no reescribe nada.
 * `pii_known_gap_rate` es informativa y no entra en `buildBaseline` (solo métricas `blocking`).
 */
export async function checkOrUpdateBaseline(options: {
  evalsDir: string;
  current: Baseline;
  metrics: readonly MetricValue[];
  update: boolean;
  /** `id` de casos con fuga; acompaña el mensaje del suelo duro. */
  piiLeakCaseIds?: readonly string[];
}): Promise<BaselineCheck> {
  const leak = options.current.metrics[PII_LEAK_RATE];
  if (leak !== undefined && leak > METRIC_TOLERANCE) {
    return {
      status: 'differs',
      stored: await readBaseline(options.evalsDir, options.current.task),
      problems: [
        {
          kind: 'pii_leak_hard_floor',
          current: leak,
          caseIds: options.piiLeakCaseIds ?? [],
        },
      ],
    };
  }

  if (options.update) {
    return {
      status: 'updated',
      path: await writeBaseline(options.evalsDir, options.current),
      baseline: options.current,
    };
  }
  const stored = await readBaseline(options.evalsDir, options.current.task);
  const comparison = compareWithBaseline(
    stored,
    options.current,
    options.metrics,
  );
  if (comparison.ok && stored.status === 'found') {
    return { status: 'matches', stored: stored.baseline };
  }
  return { status: 'differs', stored, problems: comparison.problems };
}

/** Comando que reescribe la línea base de una tarea; aparece en todos los mensajes de fallo. */
export function updateBaselineCommand(taskName: string): string {
  return `nx run ai:eval --task=${taskName} --provider=mock --update-baseline`;
}

/** Un mensaje por problema; cada uno termina con el comando `--update-baseline`. */
export function formatBaselineProblems(
  taskName: string,
  problems: readonly BaselineProblem[],
): string[] {
  const command = updateBaselineCommand(taskName);
  return problems.map((problem) => {
    const text = describeProblem(taskName, problem);
    return `${text}. Si el cambio es intencionado, ejecuta: ${command}`;
  });
}

function describeProblem(taskName: string, problem: BaselineProblem): string {
  switch (problem.kind) {
    case 'missing':
      return `[${taskName}] Sin línea base: no existe ${BASELINE_FILE_NAME}`;
    case 'invalid':
      return `[${taskName}] Línea base inválida: ${BASELINE_FILE_NAME} no cumple el formato esperado`;
    case 'prompt_changed':
      return `[${taskName}] El prompt cambió: línea base ${problem.baseline}, actual ${problem.current}`;
    case 'golden_changed':
      return `[${taskName}] El golden cambió: su hash no coincide con el de la línea base`;
    case 'schema_validity_below_one':
      return `[${taskName}] schema_validity_rate vale ${String(problem.current)} y en replay debe valer 1`;
    case 'pii_leak_hard_floor': {
      const ids =
        problem.caseIds.length === 0
          ? ''
          : ` (casos: ${problem.caseIds.join(', ')})`;
      return `[${taskName}] ${PII_LEAK_RATE} vale ${String(problem.current)} y el suelo duro exige 0${ids}; no se actualiza la línea base`;
    }
    case 'worsened':
      return `[${taskName}] ${problem.metric} empeoró: actual ${String(problem.current)}, línea base ${String(problem.baseline)}`;
    case 'improved':
      return `[${taskName}] ${problem.metric} mejoró: actual ${String(problem.current)}, línea base ${String(problem.baseline)}; actualiza la línea base`;
    case 'metric_added':
      return `[${taskName}] ${problem.metric} no está en la línea base: actual ${String(problem.current)}`;
    case 'metric_removed':
      return `[${taskName}] ${problem.metric} ya no se calcula: línea base ${String(problem.baseline)}`;
  }
}

function isNotFound(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'ENOENT' || error.code === 'ENOTDIR')
  );
}
