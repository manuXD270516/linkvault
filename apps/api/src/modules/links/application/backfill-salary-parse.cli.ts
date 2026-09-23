import {
  type BackfillSalaryParseOptions,
  BackfillSalaryParse,
} from './backfill-salary-parse.usecase';

// Lectura de argv de `api:backfill-salary-parse` (ADR-046 paso 1). Separado del caso de uso
// para probar sin Nest y para que el use case no conozca `process.argv`.

export const BACKFILL_SALARY_PARSE_DEFAULT_LIMIT = 500;
export const BACKFILL_SALARY_PARSE_MAX_LIMIT = 5000;

export { BackfillSalaryParse };

/** Opciones a partir de argv. Argumento desconocido → `RangeError`. */
export function parseBackfillSalaryParseArgs(
  args: readonly string[],
): BackfillSalaryParseOptions {
  let limit = BACKFILL_SALARY_PARSE_DEFAULT_LIMIT;
  let dryRun = false;

  for (const arg of args) {
    const [name, value] = splitArg(arg);
    switch (name) {
      case '--limit':
        limit = requireLimit(value);
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        throw new RangeError(
          `unknown argument ${name}; expected --limit or --dry-run`,
        );
    }
  }
  return { limit, dryRun };
}

function splitArg(arg: string): [name: string, value: string | undefined] {
  const separator = arg.indexOf('=');
  return separator === -1
    ? [arg, undefined]
    : [arg.slice(0, separator), arg.slice(separator + 1)];
}

function requireLimit(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new RangeError('--limit requires a positive integer');
  }
  const n = Number(value);
  if (n < 1 || n > BACKFILL_SALARY_PARSE_MAX_LIMIT) {
    throw new RangeError(
      `--limit must be between 1 and ${BACKFILL_SALARY_PARSE_MAX_LIMIT}`,
    );
  }
  return n;
}
