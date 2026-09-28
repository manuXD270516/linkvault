import { workspaceRoot } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Entrada versionada del camino crítico (change `e2e-suite`, design D7): la oferta con la que la prueba **rellena a
 * mano** el link del paso 4 y las líneas del CV del paso 6, fijas y sin identificadores de corrida, para que la clave de
 * replay del análisis de encaje sea estable. Vive junto a los fixtures de `libs/ai`, cuyo Vitest calcula con ella las
 * claves del recorrido. La crea la tarea 5.2 **solo con la oferta**; la 5.6 la completa con el CV (decisión del
 * usuario del 2026-09-27).
 *
 * `title` y `text` (el «Resumen» del editor) son lo que `match-cv` recibe de la oferta, con `skills`; `company` no entra
 * en la clave, pero sin ella la tarjeta no se da por legible («Faltan datos de esta oferta»). El editor manual no tiene
 * habilidades: una oferta escrita a mano llega al worker con `skills: []`.
 *
 * Del CV, `lines` son las líneas de las que la prueba genera el PDF, y `text` el texto **tal como lo extrae el worker**
 * (medido en la 5.5a: las mismas líneas unidas por saltos de línea, salvo dos que la extracción junta), que es lo que
 * entra en la clave; esta prueba solo usa `lines`.
 */
export const CRITICAL_PATH_INPUT_PATH = 'libs/ai/src/infrastructure/fixture-inputs/critical-path.json';

const criticalPathJobSchema = z.strictObject({
  title: z.string().min(1),
  company: z.string().min(1),
  text: z.string().min(1),
  skills: z.array(z.unknown()).length(0),
});

/**
 * Solo lo que usa la prueba. Las líneas del CV son inventadas, ASCII (el PDF mínimo no lleva acentos), sin ningún dato
 * personal ni identificador de corrida, y dan un PDF de más de 4 kB (ver `minimalPdf`).
 */
const criticalPathInputSchema = z.object({
  job: criticalPathJobSchema,
  cv: z.object({ lines: z.array(z.string().min(1).regex(/^[\x20-\x7e]+$/)).min(1) }),
});

export type CriticalPathJob = z.infer<typeof criticalPathJobSchema>;

function readCriticalPathInput(): z.infer<typeof criticalPathInputSchema> {
  const raw: unknown = JSON.parse(readFileSync(join(workspaceRoot, CRITICAL_PATH_INPUT_PATH), 'utf8'));
  return criticalPathInputSchema.parse(raw);
}

/** CV del recorrido (paso 6): las líneas fijas de la entrada versionada. */
export const CRITICAL_PATH_CV_LINES: readonly string[] = readCriticalPathInput().cv.lines;

/** Nombre del archivo del CV: con el prefijo de la suite, para que la limpieza de la cuenta remota lo reconozca (D10). */
export const CRITICAL_PATH_CV_FILE_NAME = 'e2e-cv-camino.pdf';

export function readCriticalPathJob(): CriticalPathJob {
  return readCriticalPathInput().job;
}
