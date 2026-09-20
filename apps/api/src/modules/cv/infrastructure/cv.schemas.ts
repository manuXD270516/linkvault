import type { CvFileType } from '@linkvault/shared';
import { Schema, Types } from 'mongoose';
import { isCvId, isUserId } from '../domain/identifier';

// Colección `cv_documents` (D12 de cv-upload-extract, ADR-028 §1 y "Consecuencias").
//
// Guarda los metadatos, el estado de la lectura y **el texto extraído**. El texto vive en el mismo documento y no en
// una colección aparte, que es lo que `docs/design.md` §5 ya decía; lo que lo protege no es dónde está, sino que
// **todas** las lecturas lo proyecten fuera salvo las dos que lo necesitan: la que lo escribe (en el worker) y la de
// la vista previa, que trae solo un prefijo.
//
// `extractedText` y `truncated` **existen pero no son obligatorios**: un CV recién subido todavía no tiene ninguno de
// los dos, y marcarlos `required` haría que el alta tuviera que inventarse un valor.
//
// `bufferCommands: false`: sin conexión, una operación falla enseguida en vez de quedar en cola.

export const CV_DOCUMENT_MODEL_NAME = 'CvDocument';
export const CV_DOCUMENTS_COLLECTION = 'cv_documents';
export const CV_VERSION_COUNTER_MODEL_NAME = 'CvVersionCounter';
export const CV_VERSION_COUNTERS_COLLECTION = 'cv_version_counters';

/** `keyPattern` del índice de la correlatividad; con él `duplicateKeyIs` reconoce la carrera de dos subidas. */
export const CV_VERSION_KEY: Readonly<Record<string, 1>> = {
  userId: 1,
  version: 1,
};

/** `keyPattern` del índice parcial de la marca; distingue la carrera por el `isDefault` de la de la versión. */
export const CV_DEFAULT_KEY: Readonly<Record<string, 1>> = {
  userId: 1,
  isDefault: 1,
};

export const CV_EXTRACTION_STATUSES = [
  'pending',
  'extracted',
  'failed',
] as const;

export const CV_EXTRACTION_FAILURE_REASONS = [
  'unreadable_file',
  'no_text',
  'internal_error',
] as const;

export const CV_FILE_TYPES_STORED: readonly CvFileType[] = ['pdf', 'docx'];

export interface CvExtractionSubdocument {
  status: (typeof CV_EXTRACTION_STATUSES)[number];
  failureReason?: (typeof CV_EXTRACTION_FAILURE_REASONS)[number];
  textChars: number;
  extractedAt?: Date;
}

export interface CvDocumentDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** `<userId>/<cvId>`: la compone `cvFileKey` y no sale en ninguna respuesta. */
  fileKey: string;
  fileName: string;
  fileType: CvFileType;
  sizeBytes: number;
  version: number;
  isDefault: boolean;
  uploadedAt: Date;
  extraction: CvExtractionSubdocument;
  /** Lo escribe el worker. Ninguna lectura lo proyecta salvo la vista previa, y esa trae solo su prefijo. */
  extractedText?: string;
  /** Marca de texto recortado. Vive **solo aquí**: no sale en ninguna respuesta (D1). */
  truncated?: boolean;
}

const extractionSchema = new Schema<CvExtractionSubdocument>(
  {
    status: { type: String, required: true, enum: CV_EXTRACTION_STATUSES },
    failureReason: { type: String, enum: CV_EXTRACTION_FAILURE_REASONS },
    textChars: { type: Number, required: true, min: 0, default: 0 },
    extractedAt: { type: Date },
  },
  { _id: false },
);

export const cvDocumentSchema = new Schema<CvDocumentDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    fileKey: { type: String, required: true },
    fileName: { type: String, required: true },
    fileType: { type: String, required: true, enum: CV_FILE_TYPES_STORED },
    sizeBytes: { type: Number, required: true, min: 1 },
    version: { type: Number, required: true, min: 1 },
    isDefault: { type: Boolean, required: true },
    uploadedAt: { type: Date, required: true },
    extraction: { type: extractionSchema, required: true },
    extractedText: { type: String },
    truncated: { type: Boolean },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    collection: CV_DOCUMENTS_COLLECTION,
  },
);

// Correlatividad de la versión por persona, y cierre de la carrera de dos subidas simultáneas (D3).
cvDocumentSchema.index({ ...CV_VERSION_KEY }, { unique: true });
// Como mucho un CV marcado por persona (D4). **Parcial**: los no marcados comparten `isDefault: false` y un índice
// único sin filtro dejaría a cada persona con un solo CV.
cvDocumentSchema.index(
  { ...CV_DEFAULT_KEY },
  { unique: true, partialFilterExpression: { isDefault: true } },
);
// El listado, del más reciente al más antiguo, y la promoción al borrar el marcado.
cvDocumentSchema.index({ userId: 1, uploadedAt: -1 });

/**
 * Contador de versiones por persona: **un documento por usuario, con un solo número**.
 *
 * Existe porque "los números no se reutilizan" (D3, spec `cv/documents`) y el borrado es un borrado de verdad: con las
 * versiones 1, 2 y 3, borrar la 3 deja 1 y 2, y `max(version) + 1` sobre lo que queda devolvería 3 otra vez. Ese
 * número ya significó algo —hubo un archivo que era "la v3"— y volver a darlo haría que "la v3" quisiera decir dos
 * cosas distintas en la misma cuenta. El contador es lo único que recuerda lo que ya se entregó.
 *
 * No guarda ningún dato personal: el identificador de la persona y un entero. Si una persona borra **todos** sus CV,
 * su contador se borra con el último y la numeración vuelve a empezar en 1, que es el comportamiento de una cuenta que
 * no tiene historia que respetar.
 */
export interface CvVersionCounterDocument {
  /** `userId` en hexadecimal: la clave natural, sin índice extra que mantener. */
  _id: string;
  /** Próxima versión a entregar. */
  next: number;
}

export const cvVersionCounterSchema = new Schema<CvVersionCounterDocument>(
  {
    _id: { type: String, required: true },
    next: { type: Number, required: true, min: 1 },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    collection: CV_VERSION_COUNTERS_COLLECTION,
  },
);

/**
 * Guardas de formato: un identificador que no tiene la forma de un ObjectId nunca llega a Mongo, así que no hay
 * `CastError` ni `500`; quien llama traduce el `null` en el `404 cv_not_found` uniforme.
 */
export function toCvObjectId(id: string): Types.ObjectId | null {
  return isCvId(id) ? new Types.ObjectId(id) : null;
}

export function toUserObjectId(id: string): Types.ObjectId | null {
  return isUserId(id) ? new Types.ObjectId(id) : null;
}
