import type { CvFileType } from '@linkvault/shared';
import type { CvDocumentEntity } from '../../domain/cv-document';

// Puerto de persistencia del módulo `cv` (D7 y D12 de cv-upload-extract). Se inyecta con
// `{ provide: CV_REPOSITORY, useClass: MongoCvRepository }`. Solo tipos y el token.
//
// Ningún método lanza por un identificador mal formado: devuelven `null`, `false` o una lista, y el caso de uso lo
// convierte en su `404 cv_not_found` uniforme. Toda lectura y escritura va filtrada por `userId`: el CV de otra
// persona se comporta exactamente como uno que no existe.
//
// **Ninguna lectura de aquí devuelve `extractedText`** salvo `textPreviewOf`, y esa trae solo su prefijo.

export const CV_REPOSITORY = Symbol('CV_REPOSITORY');

/** Lo que el alta guarda, ya decidido por el caso de uso. La `version` y la marca las resuelve la transacción. */
export interface NewCvDocument {
  readonly id: string;
  readonly userId: string;
  readonly fileKey: string;
  readonly fileName: string;
  readonly fileType: CvFileType;
  readonly sizeBytes: number;
  readonly uploadedAt: Date;
}

/** Vista previa tal y como sale del repositorio, con `complete` ya resuelto contra el texto guardado. */
export interface CvTextPreviewRead {
  readonly status: CvDocumentEntity['extraction']['status'];
  readonly text: string;
  readonly chars: number;
  /** `true` si el prefijo devuelto ya es **todo** el texto guardado, medido en la misma consulta. */
  readonly complete: boolean;
}

export interface CvRepository {
  /** Identificador del CV antes de subir el objeto (D7): quién sabe qué forma tiene es quien lo persiste. */
  nextId(): string;

  /** Cuántos CV tiene esa persona ahora mismo. Camino rápido del tope, antes de gastar el almacén (D3). */
  countOf(userId: string): Promise<number>;

  /**
   * Inserta el CV **como el marcado**, apagando el anterior, calculando su `version` y escribiendo el evento de alta
   * en `outbox_events`, todo en la misma transacción (ADR-009). Reintenta hasta agotar sus intentos cuando choca con
   * el índice de la versión o con el de la marca: dos subidas simultáneas de la misma persona son dos pestañas o un
   * doble clic, no un error.
   */
  insertAsDefault(document: NewCvDocument): Promise<CvDocumentEntity>;

  /** Los CV de esa persona, del más reciente al más antiguo. Sin texto. */
  listByUser(userId: string): Promise<CvDocumentEntity[]>;

  /** El CV de esa persona; `null` si no existe, es de otra o algún id está mal formado. Sin texto. */
  findOwned(cvId: string, userId: string): Promise<CvDocumentEntity | null>;

  /**
   * Marca ese CV como el de por defecto y apaga el anterior, en una transacción. Idempotente: marcarlo cuando ya lo
   * era no cambia nada y devuelve `true`. `false` si no es suyo o no existe.
   */
  setDefault(cvId: string, userId: string): Promise<boolean>;

  /**
   * Borra el CV, promueve al más reciente de los que quedan si hacía falta y escribe el evento de borrado en
   * `outbox_events`, todo en la misma transacción. `false` si no es suyo o no existe.
   */
  remove(cvId: string, userId: string): Promise<boolean>;

  /**
   * Prefijo del texto extraído y su estado, midiendo el texto guardado **en la misma consulta** para poder decir si
   * con eso ya está todo. `null` si el CV no es suyo o no existe.
   */
  textPreviewOf(cvId: string, userId: string): Promise<CvTextPreviewRead | null>;
}
