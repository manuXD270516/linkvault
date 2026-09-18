import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { workspaceRoot } from './test-config';

// Inputs del golden de `extract-pasted-job` (tarea 5.3 de paste-job-description). Los tests de `api` pegan **exactamente**
// estos textos, que ya están limpios de datos de contacto: así la clave determinista coincide con la de los fixtures
// que se graban con `nx run ai:record-fixtures --task=extract-pasted-job` y el mock en `replay` los encuentra. Se leen
// del golden en vez de copiarse para que no puedan separarse: si alguien cambia un caso, estos tests lo notan.

/** Casos del golden pensados para la suite de `api` (etiqueta `api-suite`). */
export type PastedGoldenCase =
  | 'linkedin-app-sin-cabecera'
  | 'linkedin-app-con-titulo-escrito'
  | 'oferta-entre-chat'
  | 'conversacion-no-es-oferta'
  | 'sembrado-contacto-reclutador';

/** La entrada de un caso: el texto pegado ya limpio y, si los hay, el título y la empresa escritos aparte. */
export interface PastedGoldenInput {
  readonly text: string;
  readonly knownTitle?: string;
  readonly knownCompany?: string;
}

const GOLDEN_PATH = join(
  'libs',
  'ai',
  'src',
  'evals',
  'extract-pasted-job',
  'golden.jsonl',
);

/** La entrada del caso `id` del golden, tal cual. Lanza si el caso no existe o ya no es de la suite de `api`. */
export function pastedGoldenInput(id: PastedGoldenCase): PastedGoldenInput {
  const lines = readFileSync(join(workspaceRoot(), GOLDEN_PATH), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '');
  for (const line of lines) {
    const entry = JSON.parse(line) as {
      id?: unknown;
      tags?: unknown;
      input?: PastedGoldenInput;
    };
    if (entry.id !== id) continue;
    if (!Array.isArray(entry.tags) || !entry.tags.includes('api-suite')) {
      throw new Error(`Golden case ${id} is no longer tagged api-suite`);
    }
    if (entry.input === undefined || typeof entry.input.text !== 'string') {
      throw new Error(`Golden case ${id} has no input text`);
    }
    return entry.input;
  }
  throw new Error(`Golden case ${id} not found in ${GOLDEN_PATH}`);
}
