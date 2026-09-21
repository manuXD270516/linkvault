import { Inject, Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';
import { redisRetryDelay } from './redis-health-client';

/** Token del cliente ioredis en **modo suscripción**. No es el de salud, ni el de aplicación, ni el de BullMQ. */
export const REDIS_SUBSCRIBER_CLIENT = Symbol('REDIS_SUBSCRIBER_CLIENT');

/**
 * Lo que un adaptador de avisos necesita de un cliente Redis suscriptor. Se declara aquí, y no como un `Pick` de
 * `Redis`, para dejar dicho exactamente qué se usa y para que un doble de test no tenga que fingir las 450
 * propiedades de ioredis. Lo usan enriquecimiento, comentarios y `analysis.step`.
 */
export interface RedisSubscriber {
  /** Estado de la conexión tal y como lo publica ioredis; `wait` es "creada y todavía sin conectar" (`lazyConnect`). */
  readonly status: string;
  connect(): Promise<unknown>;
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  on(event: 'ready', listener: () => void): unknown;
  off(
    event: 'message',
    listener: (channel: string, message: string) => void,
  ): unknown;
  off(event: 'ready', listener: () => void): unknown;
}

/**
 * Lo que se espera por un intento de conexión antes de darlo por perdido y volver a intentarlo. Un Redis caído contesta
 * que no en el acto, pero uno inalcanzable no contesta nada, y con el tope de diez segundos de ioredis el canal tardaría
 * eso en reengancharse. El arranque de `api` no depende de esto: no espera a que la conexión llegue.
 */
export const REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS = 2_000;

/**
 * Cliente en modo suscripción: su única razón de ser es un `SUBSCRIBE` que dura lo que dura el proceso.
 *
 * No vale el cliente de aplicación (D7 de auth-users) y no es cuestión de compartir conexión: aquél está afinado para
 * lo contrario, un comando corto dentro de una petición. Con su `lazyConnect` y su `enableOfflineQueue: false`, un
 * `SUBSCRIBE` emitido antes de que exista el socket se rechaza en el acto ("Stream isn't writeable…"), y como
 * suscribirse pasa en el arranque, el canal de avisos quedaba muerto en cualquier ejecución real: los previews se
 * escribían y ninguna pantalla abierta se enteraba. Su `commandTimeout` de 200 ms tampoco pinta nada aquí: existe para
 * que el limitador de intentos falle abierto deprisa, y esto no está en el camino de ninguna petición.
 *
 * Se mantiene `enableOfflineQueue: false` a propósito, aunque encolar el `SUBSCRIBE` también arreglaría el arranque:
 * quien se suscribe (`RedisEnrichmentNotices`) conecta primero, y sin cola un comando no puede quedarse pendiente para
 * siempre esperando a un Redis que no vuelve, que es como un `await` en `onModuleInit` bloquearía el arranque entero.
 *
 * `retryStrategy`: ioredis sigue reintentando la conexión por su cuenta después de un fallo. Al reconectar solo reenvía
 * las suscripciones que llegó a aceptar, así que quien se suscribe vuelve a pedir el canal en cada `ready`.
 */
export function createRedisSubscriberClient(url: string): Redis {
  const client = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    enableReadyCheck: false,
    connectTimeout: REDIS_SUBSCRIBER_CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    retryStrategy: redisRetryDelay,
  });
  // Sin listener, ioredis escribiría cada reintento por consola. Los fallos los avisa, uno por racha, quien usa el
  // cliente.
  client.on('error', () => undefined);
  return client;
}

/**
 * Cierra el cliente al apagar. No lo abre: la conexión la abre quien se suscribe, porque es quien sabe si el
 * `SUBSCRIBE` llegó a salir y quien avisa cuando no.
 */
@Injectable()
export class RedisSubscriberConnection implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_SUBSCRIBER_CLIENT) private readonly client: Redis,
  ) {}

  onApplicationShutdown(): void {
    this.client.disconnect();
  }
}
