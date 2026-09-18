import type { Platform } from '@linkvault/shared';

// Contrato de los canonicalizadores (D2 de job-links, ADR-008). Cada uno es una función pura que reconoce su plataforma
// y extrae el identificador de la vacante; si no la reconoce devuelve `null` y el registro prueba el siguiente. Una
// regla rota degrada a dedupe por URL (`generic`), nunca funde vacantes distintas.

/** Plataforma reconocida y, cuando la hay, su identificador de vacante. */
export interface Canonicalization {
  readonly platform: Platform;
  readonly externalJobId?: string;
}

/** Recibe la URL ya normalizada (sin `www.`, sin fragmento y sin parámetros de campaña). */
export type Canonicalizer = (url: URL) => Canonicalization | null;

/** `true` si el host es ese dominio o un subdominio suyo. La normalización ya quitó `www.`. */
export function isDomain(url: URL, domain: string): boolean {
  return url.hostname === domain || url.hostname.endsWith(`.${domain}`);
}

/** Segmentos no vacíos del path, en orden. */
export function pathSegments(url: URL): readonly string[] {
  return url.pathname.split('/').filter((segment) => segment !== '');
}
