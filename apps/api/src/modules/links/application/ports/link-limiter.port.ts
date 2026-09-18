// Puerto del límite por ventana de tiempo de `links` (D13 de link-enrichment): relecturas de un link e importaciones de
// una persona. `links` tiene su propio token y su propio puerto, y no el de `auth`: el dominio de un módulo no importa
// el de otro (ADR-020 §6). Lo que comparten es el contador de infraestructura, no este contrato.
//
// La política de fallo NO se decide aquí sino en el adaptador, porque es distinta para cada clave y está razonada en el
// design: la importación **falla abierto** —negarla por un Redis lento sería peor que dejarla pasar— y la relectura
// **falla cerrado**, porque lo que se permitiría sin contador es volver a descargar de un sitio ajeno, y negar un
// reintento no rompe nada.

export const LINK_LIMITER = Symbol('LINK_LIMITER');

export type LinkLimitKey =
  /** Relecturas de un mismo link, las pida quien las pida. */
  | { readonly kind: 'enrich-link'; readonly linkId: string }
  /** Importaciones de una persona. Guardar un link suelto NO cuenta contra este límite. */
  | { readonly kind: 'import'; readonly userId: string };

export interface LinkLimitDecision {
  readonly allowed: boolean;
  /** Segundos hasta que se reinicia la ventana si no se permite (entero ≥ 1); 0 si se permite. */
  readonly retryAfterSeconds: number;
}

export interface LinkLimiter {
  /** Cuenta un intento sobre esa clave y dice si cabe en la ventana actual. Atómico. */
  consume(key: LinkLimitKey): Promise<LinkLimitDecision>;
}
