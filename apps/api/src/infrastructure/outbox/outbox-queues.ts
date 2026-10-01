import { ANALYZE_MATCH_QUEUE, BUILD_ROADMAP_QUEUE } from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { DefaultJobOptions } from 'bullmq';

// Colas del outbox tal y como las registra `api` (D6 de job-links, D11 de cv-upload-extract, D2 de
// cv-match-suggestions; study-roadmap). Aquí solo viven su configuración y el listener de errores; quién publica
// en cada una lo decide la tabla de `outbox-routes`, y quién consume vive en `apps/worker`: `api` no procesa ninguna
// de estas colas ni monta ninguna `Queue` fuera de aquí.

/**
 * Retención y reintentos de D6 para las colas que **sí** reintentan lo que revienta (enriquecimiento, extracción y
 * borrado de CV): un job completado se olvida al día (o al llegar a 1000) y uno fallido, a la semana. Mientras el job
 * vive, el `jobId` determinista evita duplicados; pasada la retención, la garantía es la idempotencia del consumidor.
 *
 * Los reintentos son para lo que revienta, no para lo que sale mal: que una bolsa nos bloquee, que la página no sea
 * una oferta o que un PDF esté cifrado son **resultados**, se guardan con su motivo y el job termina bien. Aquí solo
 * se reintenta cuando el consumidor lanza —Mongo caído, el almacén sin responder—, y por eso son pocos y espaciados:
 * tres intentos con espera creciente desde 5 s. Sin `attempts`, BullMQ haría uno solo y un corte de un segundo
 * dejaría el agregado en `failed` sin haber reintentado nada.
 */
export const OUTBOX_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

/**
 * Opciones de `analyze-match` y `build-roadmap`: **sin reintento a ciegas** (`attempts: 1`, ADR-030 §6 /
 * study-roadmap). Reejecutar multiplicaría envíos a un proveedor externo y consumiría cuota. La retención es la
 * misma que el resto: el `jobId` determinista evita duplicados mientras el job vive; pasada la retención, manda la
 * idempotencia del consumidor (claim `generating` / escritura condicionada).
 */
export const ANALYZE_MATCH_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 1,
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

const NO_BLIND_RETRY_QUEUES = new Set<string>([
  ANALYZE_MATCH_QUEUE,
  BUILD_ROADMAP_QUEUE,
]);

/** Opciones por cola: análisis y roadmap no reintentan; el resto conserva los reintentos de D6. */
export function outboxJobOptionsFor(queue: string): DefaultJobOptions {
  return NO_BLIND_RETRY_QUEUES.has(queue)
    ? ANALYZE_MATCH_JOB_OPTIONS
    : OUTBOX_JOB_OPTIONS;
}

/** Token del listener de errores de una cola: uno por cola, para que Nest cree los tres y no se pisen. */
export function outboxQueueErrorLogToken(queue: string): string {
  return `OUTBOX_QUEUE_ERROR_LOG:${queue}`;
}

/** Lo que el registro necesita de un logger; `Logger` de Nest lo cumple. */
export interface QueueErrorLogWriter {
  debug(message: string): void;
}

/** Lo que este registro necesita de la cola: enterarse de sus errores de conexión. */
export interface QueueErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Listener de `error` de una cola. Sin él, un Redis inalcanzable haría que BullMQ emitiera `error` sin oyentes y Node
 * tumbaría el proceso. Se engancha al construirse, no en `onModuleInit`: Nest crea este provider inmediatamente
 * después de la cola, así que entre una cosa y la otra no cabe ningún `ECONNREFUSED` sin oyente.
 *
 * El nivel es `debug` a propósito: un corte de Redis produce un error por reintento de ioredis, y de que el trabajo no
 * se está publicando informa el relay con un `warn` por evento agotado.
 */
export class OutboxQueueErrorLog {
  constructor(
    private readonly name: string,
    queue: QueueErrorSource,
    private readonly writer: QueueErrorLogWriter = new Logger('OutboxQueue'),
  ) {
    queue.on('error', (error) =>
      this.writer.debug(`${this.name} queue error: ${error.message}`),
    );
  }
}
