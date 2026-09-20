/**
 * El `?import=<slug>` con el que se llega desde una oferta pública (D9 de public-preview-share).
 *
 * Se repite el patrón de `isValidPublicSlug` en lugar de importarlo de `@linkvault/shared` porque `core/` viaja en el
 * bundle inicial (presupuesto de 500 kB) y el barril de la librería arrastra zod, que solo puede entrar en chunks lazy:
 * es la misma razón por la que `core/groups/groups.api.ts` repite `normalizeInviteCode`. Un test comprueba que las dos
 * formas juzgan igual, para que no se separen.
 */
const PUBLIC_SLUG_PATTERN = /^[23456789abcdefghjkmnpqrstvwxyz]{12}$/;

/**
 * El `slug` si tiene exactamente esa forma, o `null` si no. Cualquier otra cosa se ignora y la navegación va al inicio,
 * igual que hace `safeReturnUrl` con una ruta de retorno ajena.
 */
export function importSlug(value: string | null | undefined): string | null {
  return typeof value === 'string' && PUBLIC_SLUG_PATTERN.test(value) ? value : null;
}
