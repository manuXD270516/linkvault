import { randomUUID } from 'node:crypto';
import type {
  HostLease,
  HostMutex,
} from '../../application/ports/host-mutex.port';

// Implementación de `HOST_MUTEX` (D6 de link-enrichment). Una sola clave por host hace las dos cosas:
//
// 1. `SET enrich:host:<host> <token> PX ENRICH_FETCH_TIMEOUT_MS NX` mientras se descarga. El `NX` es la exclusión y el
//    `PX` el seguro: si el proceso muere con la descarga a medias, el host se libera solo al vencer el plazo en vez de
//    quedarse tomado para siempre.
// 2. Al terminar, la misma clave se reescribe **sin `NX`** con `PX = espera efectiva`. La reescritura sin `NX` es lo
//    que convierte la exclusión en espera sin soltar el host entre medias: con un `DEL` y un `SET` habría un hueco por
//    el que otro job entraría a descargar sin esperar nada.
//
// No se usan los grupos de BullMQ (`group`/`groupKey`) porque son de BullMQ Pro y no existen en la versión instalada.

/** Prefijo de la clave por host. */
export const HOST_MUTEX_KEY_PREFIX = 'enrich:host:';

export function hostMutexKey(host: string): string {
  return `${HOST_MUTEX_KEY_PREFIX}${host}`;
}

/**
 * Lo que el adaptador necesita de Redis, declarado aquí en vez de con `Pick<Redis, …>`: un `Redis` de ioredis lo
 * cumple, y un doble de test también, sin arrastrar las cientos de sobrecargas variádicas del cliente real.
 */
export interface HostMutexClient {
  set(
    key: string,
    value: string,
    mode: 'PX',
    ms: number,
    condition: 'NX',
  ): Promise<'OK' | null>;
  set(key: string, value: string, mode: 'PX', ms: number): Promise<'OK' | null>;
  del(key: string): Promise<number>;
}

export class RedisHostMutex implements HostMutex {
  constructor(
    private readonly client: HostMutexClient,
    /** `ENRICH_FETCH_TIMEOUT_MS`: lo que como máximo puede durar la descarga que justifica el turno. */
    private readonly holdMs: number,
  ) {}

  async acquire(host: string): Promise<HostLease | null> {
    const key = hostMutexKey(host);
    // El token identifica a este turno. No se comprueba al soltar: la reescritura con `PX` es idempotente y, si el
    // plazo ya venció y otro tomó el host, dejarle la espera del sitio tampoco le hace daño.
    const token = randomUUID();
    const taken = await this.client.set(key, token, 'PX', this.holdMs, 'NX');
    // Redis devuelve `null` cuando el `NX` no pudo escribir: el host está ocupado.
    if (taken === null) return null;

    return {
      release: async (waitMs: number): Promise<void> => {
        try {
          if (waitMs > 0) {
            // Sin `NX`: el turno pasa a ser espera sin que la clave deje de existir ni un instante.
            await this.client.set(key, token, 'PX', Math.round(waitMs));
          } else {
            await this.client.del(key);
          }
        } catch {
          // El host se libera solo al vencer el plazo de la descarga; el siguiente link espera un poco más y ya.
        }
      },
    };
  }
}
