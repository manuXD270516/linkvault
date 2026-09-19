// Puerto del límite por ventana de tiempo de `links` (D13 de link-enrichment, D5 de paste-job-description): relecturas
// de un link, importaciones de una persona y pegados de descripción de una persona. `links` tiene su propio token y su propio puerto, y no el de `auth`: el dominio de un módulo no importa
// el de otro (ADR-020 §6). Lo que comparten es el contador de infraestructura, no este contrato.
//
// La política de fallo NO se decide aquí sino en el adaptador, porque es distinta para cada clave y está razonada en el
// design: la importación **falla abierto** —negarla por un Redis lento sería peor que dejarla pasar— y la relectura
// **falla cerrado**, porque lo que se permitiría sin contador es volver a descargar de un sitio ajeno, y negar un
// reintento no rompe nada. El pegado también falla cerrado —sin contador, nada acotaría las llamadas a la IA—, pero dice
// que el contador no respondió (`unavailable`), porque responder "pegaste demasiadas" a quien no pegó ninguna sería
// mentira.

export const LINK_LIMITER = Symbol('LINK_LIMITER');

export type LinkLimitKey =
  /** Relecturas de un mismo link, las pida quien las pida. */
  | { readonly kind: 'enrich-link'; readonly linkId: string }
  /** Importaciones de una persona. Guardar un link suelto NO cuenta contra este límite. */
  | { readonly kind: 'import'; readonly userId: string }
  /** Pegados de descripción de una persona, en cualquier link. */
  | { readonly kind: 'paste-description'; readonly userId: string }
  /**
   * Comentarios que publica una persona, en todos sus grupos (D6 de group-comments). Falla abierto: lo que se permite de
   * más es escribir en nuestra base y repartir a 50 conexiones como mucho. Borrar no cuenta.
   */
  | { readonly kind: 'comment'; readonly userId: string };

export interface LinkLimitDecision {
  readonly allowed: boolean;
  /** Segundos hasta que se reinicia la ventana si no se permite (entero ≥ 1); 0 si se permite. */
  readonly retryAfterSeconds: number;
  /**
   * `true` cuando no se permite porque el contador no respondió y el límite falla cerrado, no porque se agotara la
   * ventana. Quien llama lo distingue para no culpar a la persona de un Redis caído.
   */
  readonly unavailable?: boolean;
}

export interface LinkLimiter {
  /** Cuenta un intento sobre esa clave y dice si cabe en la ventana actual. Atómico. */
  consume(key: LinkLimitKey): Promise<LinkLimitDecision>;
  /**
   * Devuelve un intento ya contado: un pegado que terminó en `503` no gasta uno de los de la persona (D5). Baja el
   * contador sin pasar de cero y nunca lanza: si el contador no responde, el intento se queda gastado y nada más.
   */
  refund(key: LinkLimitKey): Promise<void>;
}
