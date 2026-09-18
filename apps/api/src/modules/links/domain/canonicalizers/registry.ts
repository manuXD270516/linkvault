import type { Canonicalization, Canonicalizer } from './canonicalizer';
import { computrabajoCanonicalizer } from './computrabajo';
import { genericCanonicalizer } from './generic';
import { getonboardCanonicalizer } from './getonboard';
import { indeedCanonicalizer } from './indeed';
import { linkedinCanonicalizer } from './linkedin';
import { trabajopolisCanonicalizer } from './trabajopolis';

// Registro de canonicalizadores (D2 de job-links): se prueban en orden y, si ninguno reconoce la URL, cae en `generic`.
// Añadir una plataforma es añadir su función a esta lista con su tabla de URLs reales en el test.

/** Canonicalizadores por plataforma, en el orden en que se prueban. `generic` no está: es el fallback. */
const CANONICALIZERS: readonly Canonicalizer[] = [
  linkedinCanonicalizer,
  computrabajoCanonicalizer,
  indeedCanonicalizer,
  trabajopolisCanonicalizer,
  getonboardCanonicalizer,
];

/**
 * Plataforma e identificador de una URL **ya normalizada** (`normalizeUrl`). Siempre devuelve algo: una URL que nadie
 * reconoce es `generic` y se deduplica por el hash de su URL normalizada.
 */
export function canonicalize(normalizedUrl: string): Canonicalization {
  const url = parse(normalizedUrl);
  if (url === null) {
    return genericCanonicalizer();
  }
  for (const canonicalizer of CANONICALIZERS) {
    const result = canonicalizer(url);
    if (result !== null) {
      return result;
    }
  }
  return genericCanonicalizer();
}

/** La URL normalizada siempre es analizable; el `null` es defensa en profundidad para no lanzar desde el dominio. */
function parse(normalizedUrl: string): URL | null {
  try {
    return new URL(normalizedUrl);
  } catch {
    return null;
  }
}
