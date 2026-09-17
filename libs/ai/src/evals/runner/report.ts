import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseResult, EvaluableTask } from '../evaluable-task';
import type { MetricValue } from '../metrics/metric';

// Reporte Markdown de una evaluación (D6 de ai-eval-harness, requisito "Corredor de evaluación"): cabecera, métricas con
// tipo y línea base, y una fila por caso. Nunca incluye inputs ni salidas completas. `renderReport` es pura; la
// escritura a disco va aparte.

export const PLACEHOLDER_TAG = 'placeholder';

export interface EvalReportData<I, O, E> {
  evaluable: EvaluableTask<I, O, E>;
  providerId: string;
  /** Modelo o modelos usados; ver `reportModel`. */
  model: string;
  generatedAt: Date;
  metrics: readonly MetricValue[];
  /**
   * Métricas bloqueantes de la línea base (solo en replay). `undefined`: sin columna de línea base (proveedores reales).
   * `null`: columna vacía (línea base ausente).
   */
  baseline?: Readonly<Record<string, number>> | null;
  results: readonly CaseResult<I, O, E>[];
}

/** Modelos distintos de los casos `success`, en orden de aparición; si no hay, el configurado o `—`. */
export function reportModel(
  results: readonly CaseResult<unknown, unknown, unknown>[],
  configuredModel?: string,
): string {
  const models = [
    ...new Set(
      results.flatMap((r) =>
        r.result.status === 'success' ? [r.result.model] : [],
      ),
    ),
  ];
  if (models.length > 0) return models.join(', ');
  return configuredModel ?? '—';
}

/** Hay casos etiquetados `placeholder`: basta uno para que las métricas no representen calidad real. */
export function hasPlaceholderCases(
  results: readonly CaseResult<unknown, unknown, unknown>[],
): boolean {
  return results.some((r) => r.goldenCase.tags.includes(PLACEHOLDER_TAG));
}

export function renderReport<I, O, E>(data: EvalReportData<I, O, E>): string {
  const { evaluable, results } = data;
  const task = evaluable.task;
  const erased = results as readonly CaseResult<unknown, unknown, unknown>[];
  const lines: string[] = [
    `# Evaluación de IA: ${task.name}`,
    '',
    `- Tarea: \`${task.name}\``,
    `- Prompt: \`${task.promptVersion}\``,
    `- Proveedor: \`${data.providerId}\``,
    `- Modelo: ${cell(data.model)}`,
    `- Fecha: ${data.generatedAt.toISOString()}`,
    `- Casos: ${String(results.length)}`,
    '',
  ];

  if (hasPlaceholderCases(erased)) {
    const count = erased.filter((r) =>
      r.goldenCase.tags.includes(PLACEHOLDER_TAG),
    ).length;
    lines.push(
      `> **Advertencia:** golden set \`${PLACEHOLDER_TAG}\` (${String(count)} de ${String(results.length)} casos): ` +
        'son casos sintéticos y las métricas no representan calidad real.',
      '',
    );
  }

  lines.push('## Métricas', '');
  const withBaseline = data.baseline !== undefined;
  lines.push(
    row(['Métrica', 'Tipo', 'Valor', ...(withBaseline ? ['Línea base'] : [])]),
    separator(withBaseline ? 4 : 3),
  );
  for (const metric of data.metrics) {
    const baselineValue =
      metric.kind === 'blocking' ? data.baseline?.[metric.name] : undefined;
    lines.push(
      row([
        `\`${metric.name}\``,
        metric.kind === 'blocking' ? 'bloqueante' : 'informativa',
        formatNumber(metric.value),
        ...(withBaseline
          ? [baselineValue === undefined ? '—' : formatNumber(baselineValue)]
          : []),
      ]),
    );
  }

  const columns = evaluable.caseColumns ?? [];
  lines.push('', '## Casos', '');
  lines.push(
    row([
      'id',
      'tags',
      'Estado',
      'Latencia (ms)',
      ...columns.map((column) => column.header),
    ]),
    separator(4 + columns.length),
  );
  for (const result of results) {
    lines.push(
      row([
        `\`${result.goldenCase.id}\``,
        result.goldenCase.tags.join(', '),
        result.result.status === 'success'
          ? 'success'
          : `degraded (${result.result.reason})`,
        formatNumber(result.latencyMs),
        ...columns.map((column) => column.value(result)),
      ]),
    );
  }
  lines.push('');
  return lines.join('\n');
}

/** Ruta del reporte: `<reportsDir>/<task>/<proveedor>.md`. */
export function reportPath(
  reportsDir: string,
  taskName: string,
  providerId: string,
): string {
  return join(reportsDir, taskName, `${providerId}.md`);
}

/** Escribe el reporte creando los directorios necesarios y devuelve su ruta. */
export async function writeReport(
  reportsDir: string,
  taskName: string,
  providerId: string,
  markdown: string,
): Promise<string> {
  const path = reportPath(reportsDir, taskName, providerId);
  await mkdir(join(reportsDir, taskName), { recursive: true });
  await writeFile(path, markdown, 'utf8');
  return path;
}

/** Enteros tal cual; el resto con 6 cifras significativas. */
export function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(6)));
}

function row(cells: readonly string[]): string {
  return `| ${cells.map(cell).join(' | ')} |`;
}

function separator(count: number): string {
  return `|${' --- |'.repeat(count)}`;
}

/** Una celda nunca rompe la tabla: sin saltos de línea y con `|` escapado. */
function cell(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
}
