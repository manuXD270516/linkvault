import {
  BACKFILL_STATUSES,
  type BackfillOptions,
  type BackfillStatus,
} from './backfill-enrichment.usecase';

// Lectura de los argumentos de `api:backfill-enrichment` (D10 de link-enrichment). Vive separado del caso de uso para
// que el comando se pueda probar sin arrancar Nest y para que el caso de uso no sepa nada de `process.argv`.
//
// Un argumento que no se entiende **para el comando**, no lo ignora: reencolar de más significa volver a descargar
// páginas ajenas, así que un `--limit` mal escrito no puede convertirse en el valor por defecto en silencio.

/** Cuántos links reencola una ejecución si no se dice otra cosa. */
export const BACKFILL_DEFAULT_LIMIT = 500;

/** Tope por ejecución: el comando avanza en tandas, no vacía la base de una vez. */
export const BACKFILL_MAX_LIMIT = 5000;

export { BackfillEnrichment } from './backfill-enrichment.usecase';

/** Opciones a partir de los argumentos. Lanza `RangeError` con lo que hay que corregir. */
export function parseBackfillArgs(args: readonly string[]): BackfillOptions {
  let status: BackfillStatus = 'pending';
  let limit = BACKFILL_DEFAULT_LIMIT;

  for (const arg of args) {
    const [name, value] = splitArg(arg);
    switch (name) {
      case '--status':
        status = requireStatus(value);
        break;
      case '--limit':
        limit = requireLimit(value);
        break;
      default:
        throw new RangeError(
          `unknown argument ${name}; expected --status or --limit`,
        );
    }
  }
  return { status, limit };
}

function splitArg(arg: string): [name: string, value: string | undefined] {
  const separator = arg.indexOf('=');
  return separator === -1
    ? [arg, undefined]
    : [arg.slice(0, separator), arg.slice(separator + 1)];
}

function requireStatus(value: string | undefined): BackfillStatus {
  const status = BACKFILL_STATUSES.find((candidate) => candidate === value);
  if (status === undefined) {
    throw new RangeError(
      `--status must be one of ${BACKFILL_STATUSES.join(', ')}`,
    );
  }
  return status;
}

function requireLimit(value: string | undefined): number {
  const limit = Number(value);
  if (
    value === undefined ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > BACKFILL_MAX_LIMIT
  ) {
    throw new RangeError(`--limit must be a whole number between 1 and ${BACKFILL_MAX_LIMIT}`);
  }
  return limit;
}
