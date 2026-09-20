import {
  ANALYZE_MATCH_QUEUE,
  CV_DELETED_EVENT_TYPE,
  CV_UPLOADED_EVENT_TYPE,
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  LINK_CREATED_EVENT_TYPE,
  MATCH_REQUESTED_EVENT_TYPE,
  cvDeletedJobId,
  cvDeletedPayloadSchema,
  cvUploadedJobId,
  cvUploadedPayloadSchema,
  linkCreatedJobId,
  linkCreatedPayloadSchema,
  matchRequestedJobId,
  matchRequestedPayloadSchema,
} from '@linkvault/shared';
import type { ZodType } from 'zod';

// Enrutado del relay por tipo de evento (D11 de cv-upload-extract, ADR-028 §9; D2 de cv-match-suggestions).
// Hasta `cv-upload-extract` el publicador conocía **un** tipo y una cola; con varios hace falta un mapa.
//
// Se eligió una tabla que el publicador consulta, y no un publicador por cola con un enrutador delante (providers
// casi iguales para tablas de una fila) ni la cola guardada en el documento del outbox (cambiaría el contrato de
// `outbox_events`, obligaría a migrar los pendientes y repartiría el conocimiento entre quien escribe y quien publica).
// Añadir un evento es **una entrada aquí**, y las tres cosas que la entrada nombra —schema, cola y `jobId`— salen del
// contrato de `libs/shared`, nunca de una constante repetida.
//
// Un tipo **desconocido** no tiene entrada, y eso es a propósito: el publicador lanza, el evento se queda pendiente y
// a las 24 h se marca `failed` con su aviso. Un evento que no sabemos publicar no debe desaparecer en silencio ni
// envenenar una cola.

/** Lo que la cola necesita de un evento ya validado. */
export interface OutboxJob {
  readonly data: Record<string, unknown>;
  /** Determinista: republicar el mismo evento deja un solo job mientras la cola lo recuerda. */
  readonly jobId: string;
}

/** Cómo se publica un tipo de evento. */
export interface OutboxRoute {
  readonly queue: string;
  /**
   * Valida el payload con el schema de su contrato y devuelve el job. **Lanza** si no cumple: un evento que no valida
   * no llega a la cola, se queda pendiente y termina agotándose con su aviso, en vez de envenenar al consumidor.
   */
  readonly job: (payload: unknown) => OutboxJob;
}

function route<T extends Record<string, unknown>>(
  queue: string,
  schema: ZodType<T>,
  jobId: (payload: T) => string,
): OutboxRoute {
  return {
    queue,
    job: (payload) => {
      const parsed = schema.parse(payload);
      return { data: parsed, jobId: jobId(parsed) };
    },
  };
}

/** Tabla `type → { schema, queue, jobId }`, con los tipos que hoy pasan por el outbox. */
export const OUTBOX_ROUTES: Readonly<Record<string, OutboxRoute>> = {
  [LINK_CREATED_EVENT_TYPE]: route(
    ENRICH_LINK_QUEUE,
    linkCreatedPayloadSchema,
    linkCreatedJobId,
  ),
  [CV_UPLOADED_EVENT_TYPE]: route(
    EXTRACT_CV_QUEUE,
    cvUploadedPayloadSchema,
    cvUploadedJobId,
  ),
  [CV_DELETED_EVENT_TYPE]: route(
    DELETE_CV_FILE_QUEUE,
    cvDeletedPayloadSchema,
    cvDeletedJobId,
  ),
  [MATCH_REQUESTED_EVENT_TYPE]: route(
    ANALYZE_MATCH_QUEUE,
    matchRequestedPayloadSchema,
    matchRequestedJobId,
  ),
};

/** La ruta de ese tipo, o `undefined` si no la conocemos. */
export function outboxRouteOf(type: string): OutboxRoute | undefined {
  return Object.hasOwn(OUTBOX_ROUTES, type) ? OUTBOX_ROUTES[type] : undefined;
}

/** Colas que el relay tiene que registrar: una por tipo, sin repetir. */
export const OUTBOX_QUEUES: readonly string[] = [
  ...new Set(Object.values(OUTBOX_ROUTES).map((entry) => entry.queue)),
];
