import {
  PARSE_SALARY_TEXT_EXTRACTOR,
  parseSalaryText,
  type ParsedSalary,
} from './parse-salary-text';
import type {
  JobSalary,
  PreviewSources,
  StoredPreview,
} from '../schemas/preview.schema';

// Aplica el parse al preview guardado (ADR-046): solo ambos extremos null;
// no-op si source manual|pasted; deep-fill de nulls; source auto + extractor.

export type ApplySalaryTextParseResult = {
  readonly preview: StoredPreview;
  readonly sources: PreviewSources;
  /** `true` si el preview/sources cambiaron. */
  readonly applied: boolean;
};

/**
 * Si el preview aún no tiene extremos numéricos y el origen no es manual/pasted,
 * parsea `text` y rellena solo campos null del salary.
 */
export function applySalaryTextParse(
  preview: StoredPreview,
  sources: PreviewSources,
  text: string,
  at: string,
): ApplySalaryTextParseResult {
  if (!shouldApplySalaryTextParse(preview, sources)) {
    return { preview, sources, applied: false };
  }

  const parsed = parseSalaryText(text);
  if (parsed === null) {
    return { preview, sources, applied: false };
  }

  const merged = mergeSalary(preview.salary ?? null, parsed);
  return {
    preview: { ...preview, salary: merged },
    sources: {
      ...sources,
      salary: {
        value: merged,
        source: 'auto',
        extractor: PARSE_SALARY_TEXT_EXTRACTOR,
        at,
      },
    },
    applied: true,
  };
}

/** Elegible: ambos extremos null/ausentes y source distinto de manual/pasted. */
export function shouldApplySalaryTextParse(
  preview: StoredPreview,
  sources: PreviewSources,
): boolean {
  const kind = sources.salary?.source;
  if (kind === 'manual' || kind === 'pasted') return false;
  return bothExtremesMissing(preview.salary);
}

function bothExtremesMissing(
  salary: StoredPreview['salary'] | undefined,
): boolean {
  if (salary === undefined || salary === null) return true;
  return salary.min === null && salary.max === null;
}

/** Deep-fill: números del parse; currency/period solo si el guardado los tiene null. */
function mergeSalary(
  existing: JobSalary | null,
  parsed: ParsedSalary,
): JobSalary {
  return {
    min: parsed.min,
    max: parsed.max,
    currency:
      existing?.currency !== undefined &&
      existing.currency !== null &&
      existing.currency !== ''
        ? existing.currency
        : (parsed.currency ?? null),
    period:
      existing?.period !== undefined && existing.period !== null
        ? existing.period
        : (parsed.period ?? null),
  };
}
