import { z } from 'zod';

// Slug del enlace público de un link compartido (D2 y D10 de public-preview-share, ADR-027 §2). Vive en `libs/shared`
// porque lo necesitan a la vez la API —que lo genera y lo busca— y el SPA, que juzga el `?import=<slug>` que le llega
// por la URL antes de pedir nada.
//
// Es **opaco**: nada del contenido entra en él, ni el título, ni la empresa, ni el grupo, ni el identificador del link.
// La comparación es exacta y sensible a mayúsculas: un slug con otra caja es un slug que no existe.

/**
 * Base32 de Crockford sin `0`, `1`, `i`, `l`, `o` ni `u`, en minúscula: 30 símbolos, 30¹² ≈ 5,3·10¹⁷ (unos 59 bits).
 * Minúsculas porque un slug se copia y se pega dentro de una URL, no se teclea como el código de invitación.
 */
export const PUBLIC_SLUG_ALPHABET = '23456789abcdefghjkmnpqrstvwxyz';

export const PUBLIC_SLUG_LENGTH = 12;

/** Patrón exacto: ni uno más, ni uno menos, ni un carácter fuera del alfabeto. */
const PUBLIC_SLUG_PATTERN = new RegExp(
  `^[${PUBLIC_SLUG_ALPHABET}]{${PUBLIC_SLUG_LENGTH}}$`,
);

/**
 * Slug tal y como viaja por la URL. No se recorta ni se pasa a minúsculas: normalizar aquí haría que `K7M2P9R4T6VW`
 * abriera la página de `k7m2p9r4t6vw`, y la spec dice que es un enlace que no existe.
 */
export const publicSlugSchema = z.string().regex(PUBLIC_SLUG_PATTERN);

/** `true` si la cadena tiene exactamente la forma de un slug público. Cualquier otra cosa es un enlace inexistente. */
export function isValidPublicSlug(slug: string): boolean {
  return PUBLIC_SLUG_PATTERN.test(slug);
}
