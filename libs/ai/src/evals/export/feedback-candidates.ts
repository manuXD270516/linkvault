import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { GOLDEN_FILE_NAME, goldenPath } from '../golden.schema';

// Export de `ai_feedback` → `candidates.jsonl` (cv-suggestions-review 4.3 / B14). Solo metadatos: nunca toca
// `golden.jsonl`. La revisión humana decide qué promover al golden.

export const CANDIDATES_FILE_NAME = 'candidates.jsonl';

/** Tareas cuyo golden no debe mutar al exportar candidatos. */
export const CANDIDATE_GUARDED_TASKS = [
  'match-cv',
  'critique-suggestions',
] as const;

/** Documento mínimo de feedback tal como lo persiste la API en `ai_feedback`. */
export interface FeedbackDoc {
  readonly id?: string;
  readonly _id?: unknown;
  readonly userId: unknown;
  readonly analysisId: unknown;
  readonly suggestionIndex: number;
  readonly afterHash: string;
  readonly createdAt: Date | string;
}

/** Línea de `candidates.jsonl` para revisión humana (sin texto de sugerencia ni CV). */
export interface FeedbackCandidateLine {
  readonly source: 'ai_feedback';
  readonly id: string;
  readonly userId: string;
  readonly analysisId: string;
  readonly suggestionIndex: number;
  readonly afterHash: string;
  readonly createdAt: string;
}

/** Ruta por defecto: candidatos de match junto al golden (no lo sustituye). */
export function candidatesPath(evalsDir: string, taskName = 'match-cv'): string {
  return join(evalsDir, taskName, CANDIDATES_FILE_NAME);
}

/** Convierte documentos de feedback en líneas JSONL (una por feedback). */
export function feedbackDocsToCandidateLines(
  docs: readonly FeedbackDoc[],
): FeedbackCandidateLine[] {
  return docs.map((doc, index) => {
    const id = stringId(doc.id ?? doc._id);
    if (id === undefined || id === '') {
      throw new Error(`feedback doc at index ${String(index)} is missing id`);
    }
    if (
      typeof doc.suggestionIndex !== 'number' ||
      !Number.isInteger(doc.suggestionIndex) ||
      doc.suggestionIndex < 0
    ) {
      throw new Error(
        `feedback doc at index ${String(index)} has invalid suggestionIndex`,
      );
    }
    if (typeof doc.afterHash !== 'string' || doc.afterHash.length === 0) {
      throw new Error(
        `feedback doc at index ${String(index)} is missing afterHash`,
      );
    }
    const userId = stringId(doc.userId);
    const analysisId = stringId(doc.analysisId);
    if (userId === undefined || analysisId === undefined) {
      throw new Error(
        `feedback doc at index ${String(index)} is missing userId or analysisId`,
      );
    }
    const createdAt =
      doc.createdAt instanceof Date
        ? doc.createdAt.toISOString()
        : new Date(doc.createdAt).toISOString();
    if (Number.isNaN(Date.parse(createdAt))) {
      throw new Error(
        `feedback doc at index ${String(index)} has invalid createdAt`,
      );
    }
    return {
      source: 'ai_feedback',
      id,
      userId,
      analysisId,
      suggestionIndex: doc.suggestionIndex,
      afterHash: doc.afterHash,
      createdAt,
    };
  });
}

/** Serializa líneas a contenido JSONL (LF). */
export function serializeCandidatesJsonl(
  lines: readonly FeedbackCandidateLine[],
): string {
  if (lines.length === 0) return '';
  return `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
}

/**
 * Escribe **solo** el archivo de candidatos. No lee ni escribe `golden.jsonl`.
 * Crea el directorio padre si hace falta.
 */
export async function writeCandidatesJsonl(
  path: string,
  lines: readonly FeedbackCandidateLine[],
): Promise<void> {
  if (path.endsWith(GOLDEN_FILE_NAME) || /[/\\]golden\.jsonl$/u.test(path)) {
    throw new Error(
      `refusing to write candidates to a golden path: ${GOLDEN_FILE_NAME}`,
    );
  }
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, serializeCandidatesJsonl(lines), 'utf8');
}

/** sha256 del contenido de un archivo; `null` si no existe. */
export async function fileSha256(path: string): Promise<string | null> {
  try {
    const content = await readFile(path);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/** Hashes de los golden de las tareas protegidas (antes/después del export). */
export async function hashGuardedGoldens(
  evalsDir: string,
  tasks: readonly string[] = CANDIDATE_GUARDED_TASKS,
): Promise<ReadonlyMap<string, string | null>> {
  const hashes = new Map<string, string | null>();
  for (const task of tasks) {
    hashes.set(task, await fileSha256(goldenPath(evalsDir, task)));
  }
  return hashes;
}

function stringId(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    'toString' in value &&
    typeof (value as { toString: () => string }).toString === 'function'
  ) {
    const text = (value as { toString: () => string }).toString();
    return text === '[object Object]' || text === '' ? undefined : text;
  }
  return undefined;
}
