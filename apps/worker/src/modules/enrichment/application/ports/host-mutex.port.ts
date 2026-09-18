// Puerto de "un host a la vez" (D6 de link-enrichment, ADR-003). Solo tipos y el token: se inyecta con
// `{ provide: HOST_MUTEX, useClass: RedisHostMutex }`.
//
// La exclusión y la espera son **la misma clave** y duran cosas distintas a propósito: mientras se descarga, el host
// queda tomado lo que dure la descarga; al terminar, la clave se reescribe con la espera que pide el sitio. Así un
// host no se retiene doce segundos por una página que tardó trescientos milisegundos.

export const HOST_MUTEX = Symbol('HOST_MUTEX');

export interface HostLease {
  /**
   * Suelta el turno dejando el host en espera durante `waitMs` (la espera efectiva: el máximo entre la configurada y
   * el `Crawl-delay` del sitio). Con `waitMs` no positivo el host queda libre de inmediato. **Nunca lanza**: no soltar
   * bien un turno solo retrasa al siguiente link, y fallar el enriquecimiento por eso sería peor.
   */
  release(waitMs: number): Promise<void>;
}

export interface HostMutex {
  /**
   * Toma el turno de ese host. Devuelve `null` si está ocupado —hay una descarga en curso o el sitio todavía está en
   * su espera—, y entonces el job se aplaza en vez de esperar ocupando un hueco del `Worker`.
   */
  acquire(host: string): Promise<HostLease | null>;
}
