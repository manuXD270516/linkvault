import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CvExtractionCombination,
  CvExtractionMetrics,
} from './cv-extraction.metrics';
import { developmentReadList, type CvFileFormat } from './child-command';
import {
  IsolatedExtractionRunner,
  type IsolatedExtractionRunnerOptions,
  type RunnerLogger,
} from './isolated-extraction.runner';
import {
  CHILD_TEST_OUT_DIR,
  CHILD_TEST_SCRIPT,
  NODE_MODULES_ROOT,
} from './isolation-test-paths';

// Utilidades de los specs de aislamiento (D10 de cv-extract-isolation). Los hijos de prueba los **escribe el test** en un
// directorio temporal; todos sus bucles son **acotados** (N6): ninguno gira más de unos segundos aunque el runner falle.

/** Preámbulo común de los hijos de prueba: el canal (descriptor 3), la lectura de `stdin` y bucles acotados. */
const PREAMBLE = `
const net = require('node:net');
const NL = String.fromCharCode(10);
const channel = new net.Socket({ fd: 3, readable: false });
const raw = (text) => new Promise((resolve, reject) => channel.write(text, (e) => (e ? reject(e) : resolve())));
const send = (message) => raw(JSON.stringify(message) + NL);
const ready = () => send({ type: 'ready' });
const readAll = async () => { const parts = []; for await (const part of process.stdin) parts.push(part); return Buffer.concat(parts); };
const spin = (ms) => { const end = Date.now() + ms; while (Date.now() < end) { /* acotado */ } };
const hold = (ms = 10000) => setTimeout(() => process.exit(0), ms);
const text = (value, extra = {}) => send({ type: 'text', text: value, pagesCapped: false, rawCapped: false, ...extra });
`;

export class ChildScripts {
  readonly directory = mkdtempSync(join(tmpdir(), 'cvx-children-'));
  private counter = 0;

  /** Escribe un hijo de prueba (CommonJS) y devuelve su ruta. */
  write(body: string): string {
    this.counter += 1;
    const path = join(this.directory, `child-${this.counter}.cjs`);
    writeFileSync(
      path,
      `${PREAMBLE}\n(async () => {\n${body}\n})().catch(() => process.exit(2));\n`,
    );
    return path;
  }

  dispose(): void {
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export class CapturedLogs implements RunnerLogger {
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }

  all(): string {
    return [...this.warnings, ...this.errors].join('\n');
  }
}

export class RecordedMetrics implements CvExtractionMetrics {
  readonly records: {
    format: CvFileFormat;
    combination: CvExtractionCombination;
  }[] = [];

  record(format: CvFileFormat, combination: CvExtractionCombination): void {
    this.records.push({ format, combination });
  }
}

export interface TestRunner {
  readonly runner: IsolatedExtractionRunner;
  readonly logs: CapturedLogs;
  readonly metrics: RecordedMetrics;
}

/** Runner de prueba para un hijo escrito por el test: concede lectura al directorio de los hijos de prueba. */
export function runnerFor(
  scripts: ChildScripts,
  script: string,
  overrides: Partial<IsolatedExtractionRunnerOptions> = {},
): TestRunner {
  const logs = new CapturedLogs();
  const metrics = new RecordedMetrics();
  const runner = new IsolatedExtractionRunner({
    scriptPath: script,
    allowRead: [scripts.directory],
    contentTimeoutMs: 5_000,
    bootTimeoutMs: 3_000,
    logger: logs,
    metrics,
    ...overrides,
  });
  return { runner, logs, metrics };
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runner con el **hijo real** compilado por el `globalSetup` a `tmp/cv-child-test/` y los flags de producción. La lista
 * de lecturas sigue la regla de D1 para los tests: el directorio de salida de `tsc` y la raíz de `node_modules`.
 */
export function realChildRunner(
  overrides: Partial<IsolatedExtractionRunnerOptions> = {},
): TestRunner {
  const logs = new CapturedLogs();
  const metrics = new RecordedMetrics();
  const runner = new IsolatedExtractionRunner({
    scriptPath: CHILD_TEST_SCRIPT,
    allowRead: developmentReadList(CHILD_TEST_OUT_DIR, NODE_MODULES_ROOT),
    contentTimeoutMs: 20_000,
    bootTimeoutMs: 10_000,
    logger: logs,
    metrics,
    ...overrides,
  });
  return { runner, logs, metrics };
}
