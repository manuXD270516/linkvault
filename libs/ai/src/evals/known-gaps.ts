import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { GoldenCase, GoldenPiiType } from './evaluable-task';
import { GOLDEN_PII_TYPES, type GoldenIssue } from './golden.schema';

// Declaración de huecos conocidos de redacción fuera del golden (ADR-030 §2, tareas 6.6–6.8). Ningún argumento del
// corredor crea ni amplía este archivo: sacarlo del suelo duro exige una decisión humana escrita.

export const KNOWN_GAPS_FILE_NAME = 'known-gaps.json';

const knownGapEntrySchema = z.strictObject({
  type: z.enum(GOLDEN_PII_TYPES),
  reason: z.string().min(1),
  decision: z.string().min(1),
});

/** Mapa identificador → entrada. Claves no vacías. */
export const knownGapsFileSchema = z.record(
  z.string().min(1),
  knownGapEntrySchema,
);

export type KnownGapEntry = z.infer<typeof knownGapEntrySchema>;
export type KnownGapsDeclaration = Readonly<Record<string, KnownGapEntry>>;

export type KnownGapsLoadResult =
  | { ok: true; gaps: KnownGapsDeclaration; raw: string }
  | { ok: false; issues: readonly GoldenIssue[] };

export function knownGapsPath(evalsDir: string, taskName: string): string {
  return join(evalsDir, taskName, KNOWN_GAPS_FILE_NAME);
}

/**
 * Lee y valida `known-gaps.json`. Ausente → issues (código 2). Entrada sin motivo o sin referencia a la decisión
 * humana → código 2 nombrando el identificador y lo que falta.
 */
export async function loadKnownGaps(
  evalsDir: string,
  taskName: string,
): Promise<KnownGapsLoadResult> {
  const path = knownGapsPath(evalsDir, taskName);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return {
      ok: false,
      issues: [
        {
          message: `known-gaps declaration not readable: ${path}`,
        },
      ],
    };
  }
  return parseKnownGaps(raw);
}

export function parseKnownGaps(raw: string): KnownGapsLoadResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      issues: [{ message: 'known-gaps.json is not valid JSON' }],
    };
  }

  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      issues: [{ message: 'known-gaps.json must be an object keyed by gap id' }],
    };
  }

  const issues: GoldenIssue[] = [];
  const gaps: Record<string, KnownGapEntry> = {};

  for (const [id, entry] of Object.entries(data)) {
    if (id.trim() === '') {
      issues.push({ message: 'known-gaps entry has an empty identifier' });
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      issues.push({
        id,
        message: 'known-gaps entry must be an object with type, reason and decision',
      });
      continue;
    }
    const record = entry as Record<string, unknown>;
    const missing: string[] = [];
    if (typeof record['reason'] !== 'string' || record['reason'].trim() === '') {
      missing.push('reason');
    }
    if (
      typeof record['decision'] !== 'string' ||
      record['decision'].trim() === ''
    ) {
      missing.push('decision');
    }
    if (missing.length > 0) {
      issues.push({
        id,
        message: `known-gaps entry is missing ${missing.join(' and ')}`,
      });
      continue;
    }
    const parsed = knownGapEntrySchema.safeParse(entry);
    if (!parsed.success) {
      issues.push({
        id,
        message: `known-gaps entry is invalid: ${parsed.error.issues
          .map((i) => i.message)
          .join('; ')}`,
      });
      continue;
    }
    gaps[id] = parsed.data;
  }

  return issues.length === 0
    ? { ok: true, gaps, raw }
    : { ok: false, issues };
}

export interface KnownGapCrossCheck {
  issues: readonly GoldenIssue[];
  /** Identificadores declarados que ningún caso marca: retirables, sin fallar la evaluación. */
  unused: readonly string[];
}

/**
 * Cruza marcas `knownGap` del golden con la declaración. Identificador no declarado → código 2 (nunca el valor).
 * Declarado sin uso → `unused` (retirable).
 */
export function crossCheckKnownGaps<I, E>(
  cases: readonly GoldenCase<I, E>[],
  gaps: KnownGapsDeclaration,
): KnownGapCrossCheck {
  const issues: GoldenIssue[] = [];
  const used = new Set<string>();

  for (const goldenCase of cases) {
    for (const annotation of goldenCase.pii ?? []) {
      if (annotation.knownGap === undefined) continue;
      used.add(annotation.knownGap);
      const declared = gaps[annotation.knownGap];
      if (declared === undefined) {
        issues.push({
          line: goldenCase.line,
          id: goldenCase.id,
          message: `knownGap "${annotation.knownGap}" is not declared in known-gaps.json`,
        });
        continue;
      }
      if (declared.type !== annotation.type) {
        issues.push({
          line: goldenCase.line,
          id: goldenCase.id,
          message: `knownGap "${annotation.knownGap}" declares type ${declared.type} but the annotation has type ${annotation.type}`,
        });
      }
    }
  }

  const unused = Object.keys(gaps)
    .filter((id) => !used.has(id))
    .sort();

  return { issues, unused };
}

export function formatKnownGapIssues(
  taskName: string,
  issues: readonly GoldenIssue[],
): string {
  const lines = issues.map((issue) => {
    const where = [
      issue.line === undefined ? null : `line ${String(issue.line)}`,
      issue.id === undefined ? null : `id "${issue.id}"`,
    ].filter((part): part is string => part !== null);
    return `  - ${where.length === 0 ? '' : `${where.join(', ')}: `}${issue.message}`;
  });
  return `Invalid known-gaps for task ${taskName}:\n${lines.join('\n')}\n`;
}

export type { GoldenPiiType };
