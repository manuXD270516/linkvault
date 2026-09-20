import { cvFileKey, type CvDeletedPayload } from '@linkvault/shared';
import type { CvFileReader } from './ports/cv-file-reader.port';

// Borrado del archivo de un CV (D8 de cv-upload-extract, ADR-028 §8). Sale de la cola `delete-cv-file`, que alimenta
// el evento `CvDeleted.v1` escrito en la misma transacción que borró el documento.
//
// **Es idempotente por naturaleza**: borrar un objeto que ya no está es un acierto en S3, así que consumir dos veces
// el mismo evento no hace daño. Lo único que se reintenta es que el almacén no responda, y para eso el adaptador
// lanza y la cola aplica su política.

export class DeleteCvFileUseCase {
  constructor(private readonly files: CvFileReader) {}

  /** La clave la compone la misma función pura que la usó al guardar el archivo. */
  async execute(payload: CvDeletedPayload): Promise<void> {
    await this.files.remove(cvFileKey(payload.userId, payload.cvId));
  }
}
