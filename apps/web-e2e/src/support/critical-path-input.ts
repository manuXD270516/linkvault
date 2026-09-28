import { workspaceRoot } from '@nx/devkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Entrada versionada del camino crítico (change `e2e-suite`, design D7): la oferta con la que la prueba **rellena a
 * mano** el link del paso 4, fija y sin identificadores de corrida, para que la clave de replay del análisis de encaje
 * sea estable. Vive junto a los fixtures de `libs/ai`. La crea la tarea 5.2 **solo con la oferta**; la 5.6 la completa
 * con el texto del CV y lo demás que midan la 5.5a y la 5.5b (decisión del usuario del 2026-09-27).
 *
 * `title` y `text` (el «Resumen» del editor) son lo que `match-cv` recibe de la oferta, con `skills`; `company` no entra
 * en la clave, pero sin ella la tarjeta no se da por legible («Faltan datos de esta oferta»). El editor manual no tiene
 * habilidades: una oferta escrita a mano llega al worker con `skills: []`.
 */
export const CRITICAL_PATH_INPUT_PATH = 'libs/ai/src/infrastructure/fixture-inputs/critical-path.json';

const criticalPathJobSchema = z.strictObject({
  title: z.string().min(1),
  company: z.string().min(1),
  text: z.string().min(1),
  skills: z.array(z.unknown()).length(0),
});

/** Solo lo que esta tarea usa: la 5.6 añadirá sus campos al fichero sin romper esta lectura. */
const criticalPathInputSchema = z.object({ job: criticalPathJobSchema });

export type CriticalPathJob = z.infer<typeof criticalPathJobSchema>;

export function readCriticalPathJob(): CriticalPathJob {
  const raw: unknown = JSON.parse(readFileSync(join(workspaceRoot, CRITICAL_PATH_INPUT_PATH), 'utf8'));
  return criticalPathInputSchema.parse(raw).job;
}
