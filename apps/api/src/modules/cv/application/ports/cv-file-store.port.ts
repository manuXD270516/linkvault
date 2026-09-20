import type { CvFileType } from '@linkvault/shared';

// Puerto del almacén de objetos de `api` (D7 de cv-upload-extract, ADR-028 §5). Se inyecta con
// `{ provide: CV_FILE_STORE, useClass: S3CvFileStore }`. Solo tipos y el token.
//
// **Tiene un solo método, `put`.** No hay `get`, y eso es una decisión, no un olvido: aquí nadie lee bytes —la descarga
// no existe y ninguna ruta devuelve el archivo—, y quien lo lee para extraer su texto es el worker, con su propio
// puerto. Dejar un `get` "por si acaso" sería dejar la puerta montada y esperando a que alguien la use.
//
// El borrado tampoco está: sale de la cola `delete-cv-file`, no de la petición HTTP (ADR-009).

export const CV_FILE_STORE = Symbol('CV_FILE_STORE');

export interface CvFileStore {
  /**
   * Sube los bytes con esa clave. Lanza si el almacén no responde, y quien llama devuelve el intento al contador y
   * responde `500`: no queda ni documento, ni evento, ni intento gastado.
   */
  put(key: string, body: Uint8Array, fileType: CvFileType): Promise<void>;
}
