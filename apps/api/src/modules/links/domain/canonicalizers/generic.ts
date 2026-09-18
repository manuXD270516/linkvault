import type { Canonicalization } from './canonicalizer';

// Última opción del registro: una URL que ningún canonicalizador reconoce es una vacante igualmente, pero su identidad
// es el hash de su URL normalizada y no un identificador de plataforma. Nunca devuelve `null`, por eso no es un
// `Canonicalizer`: es el fallback del registro.

export function genericCanonicalizer(): Canonicalization {
  return { platform: 'generic' };
}
