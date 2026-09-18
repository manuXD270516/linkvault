import { Logger } from '@nestjs/common';
import type { DefaultJobOptions } from 'bullmq';

// Cola `enrich-link` tal y como la registra `api` (D6 de job-links). Aquí solo viven su configuración y el listener de
// errores; quien publica en ella es el relay. El consumidor vive en `apps/worker/src/modules/enrichment` desde
// `link-enrichment` (D7): `api` no procesa esta cola ni monta ninguna `Queue` fuera de aquí.

/**
 * Retención de D6: un job completado se olvida al día (o al llegar a 1000) y uno fallido, a la semana. Mientras el job
 * vive, el `jobId` determinista evita duplicados; pasada la retención, la garantía es la idempotencia del consumidor.
 *
 * Los reintentos son para lo que revienta, no para lo que sale mal: que una bolsa nos bloquee o que la página no sea
 * una oferta son resultados, se guardan con su motivo y el job termina bien. Aquí solo se reintenta cuando el
 * consumidor lanza —Mongo caído, un fallo nuestro—, y por eso son pocos y espaciados: tres intentos con espera
 * creciente desde 5 s. Sin `attempts`, BullMQ haría uno solo y un corte de un segundo dejaría el link en `failed`.
 */
export const ENRICH_LINK_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 86_400, count: 1_000 },
  removeOnFail: { age: 604_800 },
};

/** Lo que el registro necesita de un logger; `Logger` de Nest lo cumple. */
export interface QueueErrorLogWriter {
  debug(message: string): void;
}

/** Lo que este registro necesita de la cola: enterarse de sus errores de conexión. */
export interface QueueErrorSource {
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * Listener de `error` de la cola. Sin él, un Redis inalcanzable haría que BullMQ emitiera `error` sin oyentes y Node
 * tumbaría el proceso. Se engancha al construirse, no en `onModuleInit`: Nest crea este provider inmediatamente
 * después de la cola, así que entre una cosa y la otra no cabe ningún `ECONNREFUSED` sin oyente.
 *
 * El nivel es `debug` a propósito: un corte de Redis produce un error por reintento de ioredis, y de que el trabajo no
 * se está publicando informa el relay con un `warn` por evento agotado.
 */
export class EnrichLinkQueueErrorLog {
  constructor(
    queue: QueueErrorSource,
    private readonly writer: QueueErrorLogWriter = new Logger(
      'EnrichLinkQueue',
    ),
  ) {
    queue.on('error', (error) =>
      this.writer.debug(`enrich-link queue error: ${error.message}`),
    );
  }
}
