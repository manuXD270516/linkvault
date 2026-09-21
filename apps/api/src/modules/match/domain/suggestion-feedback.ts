import { createHash } from 'node:crypto';

// Identidad estable de una sugerencia para feedback (design §9): índice en el informe final + hash corto del `after`.
// El hash evita guardar el texto del CV/sugerencia en `ai_feedback` y permite correlacionar con el informe.

/** Longitud del hash corto en hex (sha256 truncado). Bastante para distinguir sugerencias sin guardar el `after`. */
export const AFTER_HASH_HEX_LENGTH = 16;

/** `sha256(after)` en hex, truncado. Estable ante el mismo texto. */
export function shortAfterHash(after: string): string {
  return createHash('sha256')
    .update(after, 'utf8')
    .digest('hex')
    .slice(0, AFTER_HASH_HEX_LENGTH);
}
