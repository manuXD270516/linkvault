import type {
  EnrichmentFailureReason,
  LastEnrichmentError,
  Platform,
  PreviewSources,
  PreviewStatus,
  StoredPreview,
} from '@linkvault/shared';
import type { JobLink, NewJobLink } from '../../domain/job-link';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';

// Puerto de persistencia de la vacante canónica (D1 y D3 de job-links). Se inyecta con
// `{ provide: JOB_LINK_REPOSITORY, useClass: MongoJobLinkRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, y el caso de uso lo convierte en su 404.

export const JOB_LINK_REPOSITORY = Symbol('JOB_LINK_REPOSITORY');

/** Vacante resuelta por su `dedupeKey`, y si acaba de nacer o ya existía. */
export interface ResolvedJobLink {
  readonly link: JobLink;
  /** `true` solo si la vacante no existía en LinkVault; compartir una conocida NO cuenta. */
  readonly created: boolean;
  /**
   * `true` si la vacante ya existía y la URL no estaba en su historial, así que se acaba de añadir. Es lo que distingue
   * "se volvió a guardar con otra URL" de "se volvió a guardar la misma" (D7 de paste-job-description).
   */
  readonly urlAdded: boolean;
}

/** Lo que deja una edición manual del preview: el preview ya mezclado y su procedencia. */
export interface ManualPreviewWrite {
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
  /** Estado derivado de los campos que quedan (`previewStatusOf`): `manual` al escribir a mano, otro tras volver atrás. */
  readonly previewStatus: PreviewStatus;
  readonly now: Date;
}

/**
 * Lo que deja un reopen (ADR-041): limpia el marcador de cierre y apunta la última comprobación de frescura. Si el body
 * tocó `expiresAt`, lleva además el preview ya mezclado con procedencia manual (mismo path que PATCH preview).
 */
export interface ReopenLinkWrite {
  readonly now: Date;
  readonly preview?: ManualPreviewWrite;
}

/**
 * Lo que deja un pegado (D6 de paste-job-description): el preview ya mezclado, su procedencia, el estado derivado de los
 * campos y el motivo de fallo que sobrevive —ausente si no sobrevive ninguno—.
 */
export interface PastedPreviewWrite {
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
  readonly previewStatus: PreviewStatus;
  readonly lastEnrichmentError?: LastEnrichmentError;
  readonly now: Date;
}

/**
 * Ficha mínima de un link para pintarlo fuera de `links` (la tarjeta del tablero de `applications`): lo justo para
 * abrirlo y reconocerlo. Título y empresa faltan si el link no tiene preview o la empresa se leyó como desconocida.
 */
export interface JobLinkCard {
  readonly id: string;
  readonly displayUrl: string;
  readonly platform: Platform;
  readonly previewStatus: PreviewStatus;
  readonly title?: string;
  readonly company?: string;
}

export interface JobLinkRepository {
  /**
   * Abre una transacción, resuelve el `JobLink` por su `dedupeKey` —lo crea o reutiliza el existente añadiendo la URL
   * original a su historial— y ejecuta `work` **dentro de la misma sesión**, para que la relación con el destino y el
   * evento del outbox se escriban con él o no quede nada (ADR-009).
   *
   * Un alta simultánea de la misma URL choca con el índice único: ese error aborta la transacción y no se puede
   * continuar sobre la misma sesión, así que el adaptador reintenta la **transacción entera** y en el segundo intento el
   * documento ya existe (D3). Por eso `work` tiene que poder ejecutarse más de una vez sin efectos fuera de la sesión.
   */
  withResolvedLink<T>(
    draft: NewJobLink,
    work: (resolved: ResolvedJobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T>;

  /** Link por id; `null` si no existe o el id no tiene formato de identificador. */
  findById(linkId: string): Promise<JobLink | null>;

  /**
   * Fichas de varios links en **una sola consulta** `$in` con proyección (D1 de applications-tracking). Los ids mal
   * formados o que no existen no aportan nada; el orden de la respuesta no está garantizado.
   */
  cardsOf(linkIds: readonly string[]): Promise<JobLinkCard[]>;

  /**
   * Guarda el preview editado a mano con el estado que le dan —no lo toca el motivo del fallo— y sube `previewVersion`, **condicionado** a la versión
   * leída. Devuelve `null` si nadie casó esa condición —el link ya no existe o otra escritura ganó la carrera—, que es
   * lo que impide que una edición pise un enriquecimiento que terminó entre la lectura y la escritura (D2).
   */
  updatePreview(
    linkId: string,
    expectedVersion: number,
    changes: ManualPreviewWrite,
  ): Promise<JobLink | null>;

  /**
   * Links en ese estado, en orden de `_id` y como mucho `limit`, por el índice `{ previewStatus: 1, _id: 1 }` (D10). Con
   * `reasons`, solo los que fallaron por uno de esos motivos: es lo que deja fuera del rescate lo que la bolsa prohíbe
   * leer, lo que bloquea y lo que no era una oferta. El filtro va en la consulta y no después, para que `limit`
   * signifique "reencola tantos" y no "mira tantos".
   */
  /**
   * Guarda lo que dejó un pegado y sube `previewVersion`, **condicionado** a la versión leída, como la edición manual.
   * El estado y el motivo del fallo los decide quien llama: el motivo que no llega se borra. `null` si nadie casó la
   * condición —el link ya no existe u otra escritura ganó la carrera—, y quien llama rehace la mezcla sobre lo nuevo.
   */
  writePastedPreview(
    linkId: string,
    expectedVersion: number,
    changes: PastedPreviewWrite,
  ): Promise<JobLink | null>;

  /**
   * Reabre una vacante cerrada (ADR-041): `$unset closedAt/closedReason`, set `lastFreshnessCheckAt`, y opcionalmente
   * el preview ya mezclado (procedencia manual de `expiresAt`). Solo casa si el link tenía `closedAt`. `null` si no
   * existe, el id no vale, o ya estaba abierto.
   */
  reopen(linkId: string, changes: ReopenLinkWrite): Promise<JobLink | null>;

  listByPreviewStatus(
    status: PreviewStatus,
    limit: number,
    reasons?: readonly EnrichmentFailureReason[],
  ): Promise<JobLink[]>;

  /**
   * Abre una transacción, apunta sobre el link una petición de lectura nueva —sube `previewVersion`, vuelve a
   * `pending`, limpia `lastEnrichmentError` y apunta `previewRequestedAt`— y ejecuta `work` con el link ya actualizado
   * **dentro de la misma sesión**, para que el evento del outbox se escriba con él o no quede nada (D10).
   *
   * Es el mismo camino que el alta de un link: ni el reintento ni el backfill tocan la cola. `null` si el link no
   * existe o su id no tiene formato de identificador.
   */
  withRequestedEnrichment<T>(
    linkId: string,
    now: Date,
    work: (link: JobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T | null>;

  /**
   * Lo mismo que `withRequestedEnrichment`, pero **dentro de una transacción ya abierta**: la de `withResolvedLink`,
   * cuando volver a guardar una vacante pide su lectura (D7 de paste-job-description). Quien llama escribe el evento del
   * outbox en la misma sesión. `null` si el link no existe.
   */
  requestEnrichment(
    linkId: string,
    now: Date,
    session: TransactionSession,
  ): Promise<JobLink | null>;
}
