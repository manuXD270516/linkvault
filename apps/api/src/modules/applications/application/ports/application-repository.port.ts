import type {
  Application,
  EditWrite,
  StartedTracking,
  StatusWrite,
} from '../../domain/application.entity';
import type {
  ApplicationEvent,
  NewApplicationEvent,
} from '../../domain/application-event';
import type { ApplicationStatus } from '../../domain/application-status';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

// Puerto de persistencia de las postulaciones y su historial (D2 y D5 de applications-tracking). Se inyecta con
// `{ provide: APPLICATION_REPOSITORY, useClass: MongoApplicationRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, `false` o nada, y el caso de uso lo convierte
// en su 404 uniforme. Toda lectura y escritura de una postulación propia va filtrada por `userId`: la de otra persona
// se comporta exactamente como una que no existe.

export const APPLICATION_REPOSITORY = Symbol('APPLICATION_REPOSITORY');

/** Resultado de un alta: la postulación y si la creó esta petición o ya existía. */
export interface TrackResult {
  readonly application: Application;
  readonly created: boolean;
}

/** Lo que el grupo ve de una postulación compartida (D6): nada de etapa, notas, fecha, versión ni identificador. */
export interface SharedApplication {
  readonly linkId: string;
  readonly userId: string;
  readonly status: ApplicationStatus;
  readonly statusChangedAt: Date;
}

export interface ApplicationRepository {
  /**
   * Postulación y primer evento en una transacción. Si ya existía una de esa persona para ese link (índice único
   * `(userId, linkId)`), la devuelve intacta con `created` `false` y no escribe ningún evento. Si al releerla ya no existe
   * —otra pestaña acaba de dejar de seguirla—, repite la transacción una vez (D5).
   */
  create(tracking: StartedTracking): Promise<TrackResult>;

  /** Postulación de esa persona; `null` si no existe, es de otra o algún id está mal formado. */
  findOwned(applicationId: string, userId: string): Promise<Application | null>;

  /**
   * Cambio de estado **condicionado** por `_id`, `userId` y `write.expectedVersion`, que sube `version` en 1. El evento
   * se escribe en la misma transacción y **solo si** la escritura modificó la postulación: nunca queda un evento de un
   * cambio que no ocurrió. `false` si no casó nada (ya no existe o la versión cambió): quien llama relee y decide.
   * `sideEffects` corre en la misma sesión tras el evento de dominio (p. ej. outbox de notificaciones).
   */
  changeStatus(
    applicationId: string,
    userId: string,
    write: StatusWrite,
    event: NewApplicationEvent,
    sideEffects?: (session: TransactionSession) => Promise<void>,
  ): Promise<boolean>;

  /**
   * Notas y visibilidad, última escritura gana: no toca `version` ni `statusChangedAt` ni escribe evento. `null` si no
   * existe o es de otra persona.
   */
  update(
    applicationId: string,
    userId: string,
    write: EditWrite,
  ): Promise<Application | null>;

  /**
   * Borra la postulación de esa persona y todos sus eventos en una transacción (dejar de seguir). `false` si no borró
   * nada, y entonces no toca ningún evento.
   */
  delete(applicationId: string, userId: string): Promise<boolean>;

  /**
   * Postulaciones de esa persona, de la cambiada más recientemente a la más antigua (`updatedAt`, `_id`). Con
   * `linkIds`, solo las de esos links; los ids mal formados no aportan nada.
   */
  listByUser(
    userId: string,
    linkIds?: readonly string[],
  ): Promise<Application[]>;

  /** Historial de una postulación de esa persona, del más antiguo al más reciente; vacío si no es suya. */
  eventsOf(applicationId: string, userId: string): Promise<ApplicationEvent[]>;

  /**
   * Postulaciones compartidas (`visibility` `group`) de esos links por esas personas, en **una sola consulta** con la
   * proyección de D6. El orden no está garantizado: lo fija el caso de uso.
   */
  sharedOn(
    linkIds: readonly string[],
    memberIds: readonly string[],
  ): Promise<SharedApplication[]>;
}
