import type { CvFileType } from '@linkvault/shared';
import { Schema, Types } from 'mongoose';

// La vista que el worker tiene de `cv_documents` (D8 y D12 de cv-upload-extract). **No es el schema completo** de la
// colección —ese es el de `api`, que es quien crea los documentos— sino los campos que la extracción **lee y escribe**.
//
// Que sea parcial es seguro porque el worker nunca reemplaza un documento: solo hace `updateOne` con `$set` sobre
// rutas declaradas aquí. Lo que no declara ni se lee ni se toca; en particular, ni `fileName` ni `version` ni
// `isDefault` aparecen, y así es imposible que una escritura descuidada los mueva.

export const CV_DOCUMENT_MODEL_NAME = 'ExtractionCvDocument';
export const CV_DOCUMENTS_COLLECTION = 'cv_documents';

export interface CvExtractionSubdocument {
  status: 'pending' | 'extracted' | 'failed';
  failureReason?: 'unreadable_file' | 'no_text' | 'internal_error';
  textChars: number;
  extractedAt?: Date;
}

export interface CvDocumentDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  fileType: CvFileType;
  extraction: CvExtractionSubdocument;
  extractedText?: string;
  truncated?: boolean;
}

const extractionSchema = new Schema<CvExtractionSubdocument>(
  {
    status: { type: String, required: true },
    failureReason: { type: String },
    textChars: { type: Number, required: true, default: 0 },
    extractedAt: { type: Date },
  },
  { _id: false },
);

export const cvDocumentSchema = new Schema<CvDocumentDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    fileType: { type: String, required: true },
    extraction: { type: extractionSchema, required: true },
    extractedText: { type: String },
    truncated: { type: Boolean },
  },
  {
    bufferCommands: false,
    versionKey: false,
    // `strict: false` a propósito: el documento completo lo define `api` y aquí solo se declara la parte que se toca.
    // Con `strict: true`, una lectura descartaría en silencio los campos que este schema no nombra.
    strict: false,
    collection: CV_DOCUMENTS_COLLECTION,
  },
);

const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

/** Guarda de formato: un identificador que no tiene forma de ObjectId nunca llega a Mongo, así que no hay CastError. */
export function toCvObjectId(id: string): Types.ObjectId | null {
  return OBJECT_ID_HEX.test(id) ? new Types.ObjectId(id) : null;
}
