import {
  DEFAULT_EVALS_DIR,
  type ParseResult,
} from './args';
import { CANDIDATES_FILE_NAME } from '../export/feedback-candidates';

// Parseo de `nx run ai:export-feedback-candidates` (cv-suggestions-review 4.3).

export interface ExportFeedbackArgs {
  /** JSON array de documentos `ai_feedback` (alternativa a Mongo). */
  fromJson?: string;
  /** URI Mongo; por defecto `MONGO_URI` del entorno. */
  mongoUri?: string;
  /** Relativo al cwd o absoluto. Por defecto `<evalsDir>/match-cv/candidates.jsonl`. */
  out?: string;
  evalsDir: string;
}

export const EXPORT_FEEDBACK_USAGE =
  'Usage: nx run ai:export-feedback-candidates (--from-json=<file> | [--mongo-uri=<uri>]) ' +
  `[--out=<${CANDIDATES_FILE_NAME}>] [--evals-dir=<dir>]`;

const FLAGS: Readonly<Record<string, 'string'>> = {
  'from-json': 'string',
  'mongo-uri': 'string',
  out: 'string',
  'evals-dir': 'string',
};

export function parseExportFeedbackArgs(
  argv: readonly string[],
): ParseResult<ExportFeedbackArgs> {
  const flags = parseFlags(argv, FLAGS);
  if (!flags.ok) return fail(flags.message);
  const values = flags.args;

  const fromJson = stringFlag(values, 'from-json');
  const mongoUri = stringFlag(values, 'mongo-uri');
  if (fromJson !== undefined && mongoUri !== undefined) {
    return fail('--from-json and --mongo-uri cannot be combined');
  }

  return {
    ok: true,
    args: {
      ...optional('fromJson', fromJson),
      ...optional('mongoUri', mongoUri),
      ...optional('out', stringFlag(values, 'out')),
      evalsDir: stringFlag(values, 'evals-dir') ?? DEFAULT_EVALS_DIR,
    },
  };
}

type FlagValues = ReadonlyMap<string, string>;

function parseFlags(
  argv: readonly string[],
  specs: Readonly<Record<string, 'string'>>,
): ParseResult<FlagValues> {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index] ?? '';
    if (!token.startsWith('--') || token.length === 2) {
      return { ok: false, message: `unexpected argument ${quote(token)}` };
    }
    const equals = token.indexOf('=');
    const name = token.slice(2, equals === -1 ? undefined : equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    if (specs[name] === undefined) {
      return { ok: false, message: `unknown flag --${quote(name)}` };
    }
    if (values.has(name)) {
      return { ok: false, message: `flag --${name} is given more than once` };
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
  return values.get(name);
}

function optional<K extends string, V>(
  key: K,
  value: V | undefined,
): Partial<Record<K, V>> {
  return value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);
}

function fail(message: string): ParseResult<ExportFeedbackArgs> {
  return { ok: false, message: `${message}\n${EXPORT_FEEDBACK_USAGE}` };
}

function quote(value: string): string {
  return /^[\w.:/-]{0,40}$/.test(value) ? value : '(unprintable)';
}
