// Puerto del límite por ventana de tiempo de `cv` (D5 de cv-upload-extract, ADR-028 §6). `cv` tiene su propio token y
// su propio puerto, y no el de `links` ni el de `auth`: el dominio de un módulo no importa el de otro (ADR-020 §6). Lo
// que comparten es el contador de infraestructura, no este contrato.
//
// Las tres claves **fallan abiertas**, cada una por su razón, y esas razones viven en el adaptador.

export const CV_LIMITER = Symbol('CV_LIMITER');

export type CvLimitKey =
  /** Subidas **aceptadas** de una persona: no se consume hasta pasar la puerta de tipo y tamaño. */
  | { readonly kind: 'upload'; readonly userId: string }
  /** Vistas previas del texto de una persona, en cualquiera de sus CV. */
  | { readonly kind: 'text-preview'; readonly userId: string }
  /**
   * Archivos rechazados en la puerta (`415` y `413`). Es la clave que pone techo a una ráfaga de basura sin cobrarle
   * una subida a quien se equivoca de archivo una vez, y **nunca se devuelve**: un rechazo ocurrió.
   */
  | { readonly kind: 'reject'; readonly userId: string };

/** Las claves cuyo intento se puede devolver. La de rechazos **no está**, y por eso no hay nada que olvidar. */
export type RefundableCvLimitKey = Extract<CvLimitKey, { kind: 'upload' }>;

export interface CvLimitDecision {
  readonly allowed: boolean;
  /** Segundos hasta que se reinicia la ventana si no se permite (entero ≥ 1); 0 si se permite. */
  readonly retryAfterSeconds: number;
}

export interface CvLimiter {
  /** Cuenta un intento sobre esa clave y dice si cabe en la ventana actual. Atómico. */
  consume(key: CvLimitKey): Promise<CvLimitDecision>;
  /**
   * Devuelve un intento ya contado cuando la petición falla **después** de consumirlo y **antes** de quedar guardada:
   * cobrar por algo que no ocurrió sería cobrar dos veces a quien vuelva a intentarlo. Nunca lanza: si el contador no
   * responde, el intento se queda gastado y nada más.
   *
   * El tipo solo admite la clave de subidas: la de rechazos no se devuelve nunca, y que eso sea imposible de escribir
   * vale más que un comentario pidiéndolo.
   */
  refund(key: RefundableCvLimitKey): Promise<void>;
}
