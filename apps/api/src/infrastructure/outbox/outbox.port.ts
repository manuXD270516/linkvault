import type { TransactionSession } from './transaction-session';

// Puerto del outbox (ADR-009, D6 de job-links). El caso de uso escribe el evento **dentro** de la transacción del alta y
// nunca publica en la cola: de eso se encarga el relay. Solo tipos y el token; el adaptador (`MongoOutbox`) vive al
// lado, aquí mismo.
//
// **Contrato de plataforma** (D11 de cv-upload-extract, ADR-028 §9). Vivía en `modules/links/application/ports/` y
// subió aquí en cuanto un segundo módulo (`cv`) necesitó encolar trabajo. La salida fácil habría sido declarar un
// `CV_OUTBOX` con la misma interfaz, y se descartó: dos tokens para un único adaptador significan que cualquier cambio
// del contrato hay que hacerlo dos veces y que un test puede sustituir uno y no el otro. Es lo que ya se hizo con
// `FIXED_WINDOW_COUNTER` cuando `links` necesitó el contador de `auth` (ADR-020 §6) y con `duplicateKeyIs` (ADR-027 §10).
//
// La convención que esto fija: los contratos de plataforma —contador de ventana, outbox, sesión de transacción— viven
// en `apps/api/src/infrastructure/` y los consumen `application/` e `infrastructure/` de los módulos; **nunca
// `domain/`**, que no conoce ni framework ni transporte. Un módulo declara puerto propio solo cuando el contrato es
// **suyo** (`CV_REPOSITORY`, `CV_LIMITER` sobre el contador genérico). `outbox-port-isolation.spec.ts` lo comprueba.

export const OUTBOX = Symbol('OUTBOX');

/** Evento de integración tal y como se guarda: su tipo versionado y su payload (contratos en `libs/shared/events`). */
export interface OutboxEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface Outbox {
  /** Añade el evento como pendiente. Si la transacción no llega a confirmarse, el evento tampoco queda. */
  append(event: OutboxEvent, session: TransactionSession): Promise<void>;
}
