import {
  enrichmentFailureReasonSchema,
  previewStatusSchema,
  type PreviewStatus,
  type PreviewSources,
  type StoredPreview,
} from '@linkvault/shared';
import { Schema, Types } from 'mongoose';
import { previewSourcesSubSchema, previewSubSchema } from './preview.schemas';

// La vista que el worker tiene de `job_links` (D1 y D11 de link-enrichment). No es el schema completo de la colección
// —ese es el de `api`, que es quien crea los documentos— sino los campos que el enriquecimiento **lee y escribe**.
//
// Que sea parcial es seguro porque el worker nunca reemplaza un documento: solo hace `updateOne` con `$set` sobre
// rutas declaradas aquí y `$inc` sobre `previewVersion`. Lo que no declara ni se lee ni se toca. La forma de `preview`
// y `previewSources` sí viene entera del contrato de `libs/shared`, que es lo que el test tabular comprueba.

export const JOB_LINK_MODEL_NAME = 'EnrichmentJobLink';
export const JOB_LINKS_COLLECTION = 'job_links';

export interface JobLinkDocument {
  _id: Types.ObjectId;
  /** La primera URL que escribió una persona: es por donde se descarga, siempre (D3). */
  displayUrl: string;
  /** Quién guardó el link: a esa persona se atribuye la ejecución de la IA (D7). */
  createdBy: Types.ObjectId;
  previewStatus: PreviewStatus;
  previewVersion: number;
  preview?: StoredPreview;
  previewSources?: PreviewSources;
  lastEnrichmentError?: { reason: string; at: string };
  /** Clave del objeto en MinIO. Se lee de aquí, **nunca se calcula** a partir de `previewVersion` (D12). */
  snapshotKey?: string;
  updatedAt: Date;
}

export const jobLinkSchema = new Schema<JobLinkDocument>(
  {
    displayUrl: { type: String, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    previewStatus: {
      type: String,
      required: true,
      enum: [...previewStatusSchema.options],
    },
    previewVersion: { type: Number, required: true },
    preview: { type: previewSubSchema, required: false },
    previewSources: { type: previewSourcesSubSchema, required: false },
    lastEnrichmentError: {
      type: new Schema(
        {
          reason: {
            type: String,
            required: true,
            enum: [...enrichmentFailureReasonSchema.options],
          },
          at: { type: String, required: true },
        },
        { _id: false, versionKey: false, strict: true },
      ),
      required: false,
    },
    snapshotKey: { type: String, required: false },
    updatedAt: { type: Date, required: true },
  },
  {
    bufferCommands: false,
    versionKey: false,
    strict: true,
    minimize: false,
    collection: JOB_LINKS_COLLECTION,
  },
);

/** Guarda de formato: un identificador que no tiene forma de ObjectId nunca llega a Mongo, así que no hay 500. */
export function toLinkObjectId(linkId: string): Types.ObjectId | null {
  return Types.ObjectId.isValid(linkId) && linkId.length === 24
    ? new Types.ObjectId(linkId)
    : null;
}
