import type {
  EnrichmentFailureReason,
  PreviewSources,
  PreviewStatus,
  StoredPreview,
} from '@linkvault/shared';

// Puerto de persistencia del link para el enriquecimiento (D1 y D2 de link-enrichment). Solo tipos y el token: se
// inyecta con `{ provide: LINK_REPOSITORY, useClass: MongoLinkRepository }`.
//
// La idempotencia del consumidor vive aquí, en la forma del puerto: **toda escritura va condicionada a la versión que
// se leyó**. Quien llama no puede escribir "a lo que salga", y por eso dos enriquecimientos simultáneos no se pisan
// aunque los dos terminen.

export const LINK_REPOSITORY = Symbol('LINK_REPOSITORY');

/** El link tal y como lo necesita el enriquecimiento. */
export interface EnrichableLink {
  readonly id: string;
  /** Por donde se descarga: la primera URL que escribió una persona, nunca la normalizada (D3). */
  readonly displayUrl: string;
  /** Quién lo guardó: a esa persona se atribuye la ejecución de la IA (D7). */
  readonly createdBy: string;
  readonly previewStatus: PreviewStatus;
  readonly previewVersion: number;
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
}

/** Lo que una pasada deja escrito en el link. */
export interface PreviewWrite {
  readonly previewStatus: PreviewStatus;
  readonly preview: StoredPreview;
  readonly previewSources: PreviewSources;
  /** El motivo del fallo, o `null` para borrar el del intento anterior. Nunca el cuerpo de la respuesta (D5). */
  readonly lastEnrichmentError: {
    readonly reason: EnrichmentFailureReason;
    readonly at: string;
  } | null;
  readonly at: Date;
}

export interface LinkRepository {
  /** `null` si el link ya no existe o el identificador no tiene forma de identificador. */
  findById(linkId: string): Promise<EnrichableLink | null>;

  /**
   * Escribe el resultado **solo si** el link sigue en `expectedVersion`, y sube la versión en uno. Devuelve `false`
   * cuando no modificó nada: otro ganó la carrera —otro enriquecimiento o una edición a mano— y este job termina sin
   * reintento.
   *
   * La versión sube también cuando el resultado es un fallo. Es lo que hace que reprocesar el mismo evento no vuelva a
   * pedirle la página al sitio: el job repetido trae la versión vieja y se descarta antes de descargar nada.
   */
  writePreview(
    linkId: string,
    expectedVersion: number,
    write: PreviewWrite,
  ): Promise<boolean>;

  /**
   * Guarda la clave del snapshot, **después** de haber ganado la escritura condicionada (D12). Es una escritura
   * aparte y no parte de `writePreview` porque el objeto se sube después de ganar: la ejecución perdedora no llega a
   * subir nada y no puede dejar su clave. Un fallo aquí no impide que el preview esté guardado.
   */
  saveSnapshotKey(linkId: string, snapshotKey: string): Promise<void>;
}
