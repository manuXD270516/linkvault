import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import type { OutputLanguage } from '../domain/run-context';

// Registro de entradas pendientes de fixture (requisito "Registro de entradas pendientes de fixture" de
// ai/deterministic-mock, tarea 4.6 de link-enrichment).
//
// Lo escribe `runTask`, no el mock: el idioma de salida forma parte de la clave y de lo que hay que volver a grabar, y
// el mock solo ve la clave ya calculada.
//
// El archivo es **JSONL append-only** y se deduplica **al consumirlo**, no al escribirlo: Vitest paraleliza por archivo
// y varios procesos anotan a la vez, así que un único JSON reescrito perdería anotaciones por carrera. Un `append` de
// una línea corta con `O_APPEND` no se entrelaza con el de otro proceso.
//
// Solo se escribe durante los tests. Fuera de ellos no se escribe nada: el registro existe para que `ai:record-fixtures
// --from-pending` sepa qué falta, no para observar producción.

/** Ruta del registro; relativa se resuelve contra la raíz del workspace o el directorio de trabajo. */
export const PENDING_FIXTURES_FILE_VAR = 'AI_PENDING_FIXTURES_FILE';

/** `off` apaga el registro: lo usan los tests que esperan la ausencia de un fixture a propósito. */
export const PENDING_FIXTURES_SWITCH_VAR = 'AI_PENDING_FIXTURES';

export const PENDING_FIXTURES_OFF = 'off';

export const PENDING_FIXTURES_DEFAULT_PATH = 'tmp/ai-pending-fixtures.jsonl';

/** Una entrada anotada: lo justo para volver a grabar su fixture. */
export const pendingFixtureSchema = z.strictObject({
  task: z.string().min(1),
  promptVersion: z.string().min(1),
  outputLanguage: z.enum(['es', 'en']),
  /** Clave de ejecución (ADR-018 §3): el nombre del fixture que falta. */
  key: z.string().regex(/^[0-9a-f]{64}$/),
  /**
   * Entrada ya parseada de la tarea. Ausente en tareas `personal`: el registro vive en disco y CLAUDE.md prohíbe
   * guardar texto de CV, así que de esas solo queda constancia de que su fixture falta.
   */
  input: z.unknown().optional(),
  /** `true` cuando la entrada no se anotó por ser de una tarea `personal`. */
  redacted: z.boolean(),
});
export type PendingFixture = z.infer<typeof pendingFixtureSchema>;

export interface PendingFixtureLog {
  /** Anota una entrada. Nunca lanza: un registro roto no puede cambiar el resultado de un test. */
  record(entry: PendingFixture): void;
}

/** Entorno mínimo que decide dónde y si se escribe. */
export type PendingFixtureEnv = Readonly<Record<string, string | undefined>>;

export class JsonlPendingFixtureLog implements PendingFixtureLog {
  constructor(readonly path: string) {}

  record(entry: PendingFixture): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      appendFileSync(this.path, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // Sin registro se sigue fallando por `FixtureMissing`, que es lo que el test tiene que ver.
    }
  }
}

/**
 * Registro efectivo, o `null` si no hay que escribir nada: fuera de los tests (`VITEST`, que fija el propio corredor)
 * y cuando un test lo apaga con `AI_PENDING_FIXTURES=off`.
 */
export function pendingFixtureLogFrom(
  env: PendingFixtureEnv = process.env,
): PendingFixtureLog | null {
  const path = pendingFixturePath(env);
  return path === null ? null : new JsonlPendingFixtureLog(path);
}

/** Ruta absoluta del registro, o `null` si está apagado. */
export function pendingFixturePath(
  env: PendingFixtureEnv = process.env,
): string | null {
  if (env['VITEST'] === undefined) return null;
  if (env[PENDING_FIXTURES_SWITCH_VAR] === PENDING_FIXTURES_OFF) return null;

  const configured = env[PENDING_FIXTURES_FILE_VAR];
  const path =
    configured === undefined || configured === ''
      ? PENDING_FIXTURES_DEFAULT_PATH
      : configured;
  if (isAbsolute(path)) return path;
  // Un único registro por workspace aunque cada proyecto corra con su propio directorio de trabajo.
  const base = env['NX_WORKSPACE_ROOT'] ?? process.cwd();
  return join(base, path);
}

/**
 * Entradas anotadas, **una por clave** y en orden de primera aparición. Las líneas en blanco, las que no son JSON y
 * las que no cumplen el schema se ignoran: el registro lo escriben varios procesos y una línea rota no puede impedir
 * grabar las demás.
 */
export function readPendingFixtures(path: string): PendingFixture[] {
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const byKey = new Map<string, PendingFixture>();
  for (const line of content.split(/\r?\n/)) {
    if (line.trim() === '') continue;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const parsed = pendingFixtureSchema.safeParse(data);
    if (!parsed.success) continue;
    // La primera anotación de una clave gana: las demás dicen lo mismo.
    if (!byKey.has(parsed.data.key)) byKey.set(parsed.data.key, parsed.data);
  }
  return [...byKey.values()];
}
