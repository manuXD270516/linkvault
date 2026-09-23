import type { SearchDocType } from '@linkvault/shared';
import {
  type BackfillSearchOptions,
  BackfillSearch,
} from './backfill-search.usecase';

export { BackfillSearch };

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 5000;

const DOC_TYPES: readonly SearchDocType[] = [
  'job_preview',
  'application',
  'cv',
  'roadmap',
  'group_comment',
  'group_link_note',
] as const;

/** Parse `api:backfill-search` argv. Unknown args throw `RangeError`. */
export function parseBackfillSearchArgs(
  args: readonly string[],
): BackfillSearchOptions {
  let limit = DEFAULT_LIMIT;
  let dryRun = false;
  let reembed = false;
  let docType: SearchDocType | undefined;
  let userId: string | undefined;

  for (const arg of args) {
    const [name, value] = splitArg(arg);
    switch (name) {
      case '--limit':
        limit = requireLimit(value);
        break;
      case '--docType':
        docType = requireDocType(value);
        break;
      case '--userId':
        if (value === undefined || value.trim() === '') {
          throw new RangeError('--userId requires a value');
        }
        userId = value.trim();
        break;
      case '--dry-run':
        dryRun = true;
        break;
      case '--reembed':
        reembed = true;
        break;
      default:
        throw new RangeError(
          `unknown argument ${name}; expected --limit, --docType, --userId, --dry-run, or --reembed`,
        );
    }
  }
  return { limit, dryRun, reembed, docType, userId };
}

function splitArg(arg: string): [name: string, value: string | undefined] {
  const separator = arg.indexOf('=');
  return separator === -1
    ? [arg, undefined]
    : [arg.slice(0, separator), arg.slice(separator + 1)];
}

function requireLimit(value: string | undefined): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new RangeError('--limit requires a non-negative integer');
  }
  const n = Number(value);
  if (n < 1 || n > MAX_LIMIT) {
    throw new RangeError(`--limit must be between 1 and ${MAX_LIMIT}`);
  }
  return n;
}

function requireDocType(value: string | undefined): SearchDocType {
  if (value === undefined || !(DOC_TYPES as readonly string[]).includes(value)) {
    throw new RangeError(
      `--docType must be one of ${DOC_TYPES.join('|')}`,
    );
  }
  return value as SearchDocType;
}
