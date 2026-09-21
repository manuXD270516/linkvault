import {
  KNOWN_PROVIDER_IDS,
  type AiProviderId,
} from '../../infrastructure/config/ai-config.schema';

// Parseo de argumentos y códigos de salida de los CLI del eval harness (D2 y D6 de ai-eval-harness). Compartido por
// `eval.ts` y `record-fixtures.ts`. Acepta `--flag=valor` y `--flag valor`; los booleanos admiten `--flag`,
// `--flag=true` y `--flag=false`. Un flag desconocido, repetido o sin valor es un error de uso (código 2).

/** Códigos de salida (D6). */
export const EXIT_CODES = {
  /** Éxito; con proveedores reales, también con casos degradados. */
  success: 0,
  /** Regresión respecto a la línea base o grabación incompleta. */
  regression: 1,
  /** Uso o configuración. */
  usage: 2,
  /** Error de programación (`AiProgrammingError`, incluido `FixtureMissing`). */
  programming: 3,
} as const;

export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];

export const DEFAULT_EVALS_DIR = 'libs/ai/src/evals';
export const DEFAULT_REPORTS_DIR = 'reports/eval';

export type ParseResult<T> =
  { ok: true; args: T } | { ok: false; message: string };

export interface EvalArgs {
  /** Tarea concreta; ausente con `--all`. */
  task?: string;
  all: boolean;
  provider: AiProviderId;
  updateBaseline: boolean;
  allowExternal: boolean;
  ollamaUrl?: string;
  timeoutMs?: number;
  /** Relativo al directorio de trabajo o absoluto. */
  evalsDir: string;
  reportsDir: string;
}

/**
 * Upstreams desde los que se puede grabar (D7 + cv-match-suggestions 6.14/6.18). `mock` es el único permitido
 * para tareas `personal`; ollama/openrouter siguen para tareas `public`.
 */
export const RECORDING_UPSTREAMS = ['mock', 'ollama', 'openrouter'] as const;
export type RecordingUpstream = (typeof RECORDING_UPSTREAMS)[number];

export interface RecordFixturesArgs {
  /** Ausente solo con `--from-pending` sin filtrar por tarea. */
  task?: string;
  /** `--from-pending`: graba lo anotado por los tests en vez de los casos del golden. */
  fromPending: boolean;
  /** `--pending-file`: registro de entradas pendientes; solo con `--from-pending`. */
  pendingFile?: string;
  upstream: RecordingUpstream;
  overwrite: boolean;
  allowExternal: boolean;
  ollamaUrl?: string;
  timeoutMs?: number;
  evalsDir: string;
}

type FlagKind = 'string' | 'boolean';
type FlagValues = ReadonlyMap<string, string | boolean>;

const EVAL_FLAGS: Readonly<Record<string, FlagKind>> = {
  task: 'string',
  all: 'boolean',
  provider: 'string',
  'update-baseline': 'boolean',
  'allow-external': 'boolean',
  'ollama-url': 'string',
  'timeout-ms': 'string',
  'evals-dir': 'string',
  'reports-dir': 'string',
};

const RECORD_FIXTURES_FLAGS: Readonly<Record<string, FlagKind>> = {
  task: 'string',
  'from-pending': 'boolean',
  'pending-file': 'string',
  upstream: 'string',
  overwrite: 'boolean',
  'allow-external': 'boolean',
  'ollama-url': 'string',
  'timeout-ms': 'string',
  'evals-dir': 'string',
};

export const EVAL_USAGE =
  'Usage: nx run ai:eval (--task=<task> | --all) --provider=<mock|ollama|openrouter> [--update-baseline] ' +
  '[--allow-external] [--ollama-url=<url>] [--timeout-ms=<ms>] [--evals-dir=<dir>] [--reports-dir=<dir>]';

export const RECORD_FIXTURES_USAGE =
  'Usage: nx run ai:record-fixtures (--task=<task> | --from-pending [--task=<task>]) ' +
  '--upstream=<mock|ollama|openrouter> [--pending-file=<file>] [--overwrite] [--allow-external] ' +
  '[--ollama-url=<url>] [--timeout-ms=<ms>] [--evals-dir=<dir>]';

export function parseEvalArgs(argv: readonly string[]): ParseResult<EvalArgs> {
  const flags = parseFlags(argv, EVAL_FLAGS);
  if (!flags.ok) return fail(flags.message, EVAL_USAGE);
  const values = flags.args;

  const task = stringFlag(values, 'task');
  const all = booleanFlag(values, 'all');
  if (task === undefined && !all) {
    return fail('either --task or --all is required', EVAL_USAGE);
  }
  if (task !== undefined && all) {
    return fail('--task and --all cannot be combined', EVAL_USAGE);
  }

  const provider = stringFlag(values, 'provider');
  if (provider === undefined) {
    return fail('--provider is required', EVAL_USAGE);
  }
  if (!isOneOf(KNOWN_PROVIDER_IDS, provider)) {
    return fail(
      `--provider must be one of ${KNOWN_PROVIDER_IDS.join(', ')}`,
      EVAL_USAGE,
    );
  }

  const updateBaseline = booleanFlag(values, 'update-baseline');
  if (updateBaseline && provider !== 'mock') {
    return fail(
      '--update-baseline is only allowed with --provider=mock',
      EVAL_USAGE,
    );
  }

  const timeoutMs = timeoutFlag(values);
  if (timeoutMs === null) {
    return fail('--timeout-ms must be a positive integer', EVAL_USAGE);
  }

  return {
    ok: true,
    args: {
      ...(task === undefined ? {} : { task }),
      all,
      provider,
      updateBaseline,
      allowExternal: booleanFlag(values, 'allow-external'),
      ...optional('ollamaUrl', stringFlag(values, 'ollama-url')),
      ...optional('timeoutMs', timeoutMs),
      evalsDir: stringFlag(values, 'evals-dir') ?? DEFAULT_EVALS_DIR,
      reportsDir: stringFlag(values, 'reports-dir') ?? DEFAULT_REPORTS_DIR,
    },
  };
}

export function parseRecordFixturesArgs(
  argv: readonly string[],
): ParseResult<RecordFixturesArgs> {
  const flags = parseFlags(argv, RECORD_FIXTURES_FLAGS);
  if (!flags.ok) return fail(flags.message, RECORD_FIXTURES_USAGE);
  const values = flags.args;

  const task = stringFlag(values, 'task');
  const fromPending = booleanFlag(values, 'from-pending');
  if (task === undefined && !fromPending) {
    return fail(
      '--task is required unless --from-pending',
      RECORD_FIXTURES_USAGE,
    );
  }
  const pendingFile = stringFlag(values, 'pending-file');
  if (pendingFile !== undefined && !fromPending) {
    return fail(
      '--pending-file requires --from-pending',
      RECORD_FIXTURES_USAGE,
    );
  }
  const upstream = stringFlag(values, 'upstream');
  if (upstream === undefined) {
    return fail('--upstream is required', RECORD_FIXTURES_USAGE);
  }
  if (!isOneOf(RECORDING_UPSTREAMS, upstream)) {
    return fail(
      `--upstream must be one of ${RECORDING_UPSTREAMS.join(', ')}`,
      RECORD_FIXTURES_USAGE,
    );
  }
  const timeoutMs = timeoutFlag(values);
  if (timeoutMs === null) {
    return fail(
      '--timeout-ms must be a positive integer',
      RECORD_FIXTURES_USAGE,
    );
  }

  return {
    ok: true,
    args: {
      ...optional('task', task),
      fromPending,
      ...optional('pendingFile', pendingFile),
      upstream,
      overwrite: booleanFlag(values, 'overwrite'),
      allowExternal: booleanFlag(values, 'allow-external'),
      ...optional('ollamaUrl', stringFlag(values, 'ollama-url')),
      ...optional('timeoutMs', timeoutMs),
      evalsDir: stringFlag(values, 'evals-dir') ?? DEFAULT_EVALS_DIR,
    },
  };
}

function parseFlags(
  argv: readonly string[],
  specs: Readonly<Record<string, FlagKind>>,
): ParseResult<FlagValues> {
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--') || token.length === 2) {
      return { ok: false, message: `unexpected argument ${quote(token)}` };
    }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const kind = specs[name];
    if (kind === undefined) {
      return { ok: false, message: `unknown flag --${quote(name)}` };
    }
    if (values.has(name)) {
      return { ok: false, message: `flag --${name} is given more than once` };
    }

    if (kind === 'boolean') {
      if (inline === undefined || inline === 'true') values.set(name, true);
      else if (inline === 'false') values.set(name, false);
      else {
        return { ok: false, message: `flag --${name} takes no value` };
      }
      continue;
    }

    let value = inline;
    if (value === undefined) {
      const next = argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) {
        value = next;
        index++;
      }
    }
    if (value === undefined || value === '') {
      return { ok: false, message: `flag --${name} requires a value` };
    }
    values.set(name, value);
  }
  return { ok: true, args: values };
}

function stringFlag(values: FlagValues, name: string): string | undefined {
  const value = values.get(name);
  return typeof value === 'string' ? value : undefined;
}

function booleanFlag(values: FlagValues, name: string): boolean {
  return values.get(name) === true;
}

/** `undefined` si no se pasa; `null` si no es un entero positivo. */
function timeoutFlag(values: FlagValues): number | undefined | null {
  const raw = stringFlag(values, 'timeout-ms');
  if (raw === undefined) return undefined;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, V>);
}

function fail<T>(message: string, usage: string): ParseResult<T> {
  return { ok: false, message: `${message}\n${usage}` };
}

/** Repite un argumento solo si es corto y sin caracteres de control; nunca lo que parezca una credencial larga. */
function quote(value: string): string {
  return /^[\w.:/-]{0,40}$/.test(value) ? value : '(unprintable)';
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}
