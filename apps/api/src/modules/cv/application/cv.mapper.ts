import type { CvDocument as CvDocumentResponse } from '@linkvault/shared';
import type { CvDocumentEntity } from '../domain/cv-document';

// Representación de un CV en la API (D1, ADR-028 §1). Se escribe **campo a campo, nunca con un spread del dominio**:
// es la segunda de las tres barreras que impiden que el texto, la marca de recorte, la clave del objeto o el `userId`
// del dueño salgan por HTTP. La primera es el `strictObject` del contrato; la tercera, la proyección del repositorio.
//
// Un `...document` aquí aguantaría hoy y se rompería el día que la colección gane un campo.

export function toCvResponse(
  document: CvDocumentEntity,
  matchAnalysesCount = 0,
): CvDocumentResponse {
  return {
    id: document.id,
    fileName: document.fileName,
    fileType: document.fileType,
    sizeBytes: document.sizeBytes,
    version: document.version,
    isDefault: document.isDefault,
    uploadedAt: document.uploadedAt.toISOString(),
    extraction: {
      status: document.extraction.status,
      ...(document.extraction.failureReason === undefined
        ? {}
        : { failureReason: document.extraction.failureReason }),
      textChars: document.extraction.textChars,
      ...(document.extraction.extractedAt === undefined
        ? {}
        : { extractedAt: document.extraction.extractedAt.toISOString() }),
    },
    // `0` es legítimo: el campo siempre viaja; del análisis solo sale cuántos son (tarea 11.5).
    matchAnalysesCount,
  };
}

/** Aplica el recuento por CV; ausente en el mapa → `0`. */
export function toCvResponses(
  documents: readonly CvDocumentEntity[],
  countsByCv: ReadonlyMap<string, number>,
): CvDocumentResponse[] {
  return documents.map((document) =>
    toCvResponse(document, countsByCv.get(document.id) ?? 0),
  );
}
