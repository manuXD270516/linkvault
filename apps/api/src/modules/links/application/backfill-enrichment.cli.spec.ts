import { describe, expect, it } from 'vitest';
import {
  BACKFILL_DEFAULT_LIMIT,
  BACKFILL_MAX_LIMIT,
  parseBackfillArgs,
} from './backfill-enrichment.cli';

// Argumentos de `api:backfill-enrichment` (tarea 6.10). Un argumento mal escrito no se ignora: reencolar de más
// significa volver a descargar páginas ajenas.

describe('parseBackfillArgs', () => {
  it('walks the pending links by default', () => {
    expect(parseBackfillArgs([])).toEqual({
      status: 'pending',
      limit: BACKFILL_DEFAULT_LIMIT,
    });
  });

  it('takes the status and the limit', () => {
    expect(parseBackfillArgs(['--status=failed', '--limit=25'])).toEqual({
      status: 'failed',
      limit: 25,
    });
  });

  it.each([
    ['--status=enriched'],
    ['--status'],
    ['--limit=0'],
    ['--limit=-1'],
    ['--limit=todos'],
    [`--limit=${BACKFILL_MAX_LIMIT + 1}`],
    ['--todo'],
  ])('refuses %s instead of falling back to the default', (arg) => {
    expect(() => parseBackfillArgs([arg])).toThrow(RangeError);
  });
});
