import {
  platformSchema,
  previewStatusSchema,
  type Platform,
  type PreviewStatus,
} from '@linkvault/shared';
import { Schema, Types } from 'mongoose';
import { isGroupId, isLinkId, isUserId } from '../domain/identifier';

// Colecciones del módulo `links` (D1 de job-links).
//
// - `job_links` es la vacante canónica. Su `dedupeKey` (`<platform>:<externalJobId>` o `url:<urlHash>`) unifica los dos
//   casos de ADR-008 en un solo índice único, sin índices parciales que compitan. `displayUrl` es un campo propio e
//   inmutable: `originalUrls` conserva las 20 últimas, así que recortar el historial no puede cambiar el enlace que el
//   SPA abre y que `link-enrichment` descargará.
// - `group_links` y `user_links` son relaciones: un índice único que impide la relación repetida y un compuesto con
//   `_id` para paginar por `(fecha, _id)` descendentes sin saltos ni repetidos.
//
// `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar en cola.

export const JOB_LINK_MODEL_NAME = 'JobLink';
export const JOB_LINKS_COLLECTION = 'job_links';
export const GROUP_LINK_MODEL_NAME = 'GroupLink';
export const GROUP_LINKS_COLLECTION = 'group_links';
export const USER_LINK_MODEL_NAME = 'UserLink';
export const USER_LINKS_COLLECTION = 'user_links';

export interface JobLinkDocument {
  _id: Types.ObjectId;
  /** Solo identidad: no se abre ni se descarga. */
  normalizedUrl: string;
  urlHash: string;
  /** Única entre todas las vacantes. */
  dedupeKey: string;
  platform: Platform;
  /** Ausente cuando ningún canonicalizador reconoció la URL. */
  externalJobId?: string;
  /** La primera URL que escribió una persona. Se fija en el alta y no cambia nunca. */
  displayUrl: string;
  /** Las 20 últimas URLs originales. */
  originalUrls: string[];
  previewStatus: PreviewStatus;
  previewVersion: number;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupLinkDocument {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  linkId: Types.ObjectId;
  /** Quien lo compartió primero; no cambia aunque otro lo vuelva a compartir. */
  sharedBy: Types.ObjectId;
  sharedAt: Date;
}

export interface UserLinkDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  linkId: Types.ObjectId;
  savedAt: Date;
}

const schemaOptions = {
  bufferCommands: false,
  versionKey: false,
  strict: true,
} as const;

export const jobLinkSchema = new Schema<JobLinkDocument>(
  {
    normalizedUrl: { type: String, required: true },
    urlHash: { type: String, required: true },
    dedupeKey: { type: String, required: true },
    platform: { type: String, required: true, enum: [...platformSchema.options] },
    externalJobId: { type: String, required: false },
    displayUrl: { type: String, required: true },
    originalUrls: { type: [String], required: true },
    previewStatus: {
      type: String,
      required: true,
      enum: [...previewStatusSchema.options],
    },
    previewVersion: { type: Number, required: true },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: JOB_LINKS_COLLECTION },
);

// Una vacante por clave de dedupe: es lo que cierra la carrera de dos altas simultáneas de la misma URL (D3).
jobLinkSchema.index({ dedupeKey: 1 }, { unique: true });

export const groupLinkSchema = new Schema<GroupLinkDocument>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    sharedBy: { type: Schema.Types.ObjectId, required: true },
    sharedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: GROUP_LINKS_COLLECTION },
);

// Un grupo tiene cada link una sola vez: compartir dos veces no duplica ni cambia quién lo compartió (D4).
groupLinkSchema.index({ groupId: 1, linkId: 1 }, { unique: true });
// Listado paginado del grupo. El `_id` desempata: sin él, 50 links guardados en el mismo instante se repetirían o se
// saltarían al pasar de página (D8).
groupLinkSchema.index({ groupId: 1, sharedAt: -1, _id: -1 });

export const userLinkSchema = new Schema<UserLinkDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    savedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: USER_LINKS_COLLECTION },
);

// Una entrada privada por persona y link; guardar dos veces no crea una segunda.
userLinkSchema.index({ userId: 1, linkId: 1 }, { unique: true });
// Listado paginado de la lista privada, con el mismo desempate por `_id`.
userLinkSchema.index({ userId: 1, savedAt: -1, _id: -1 });

/**
 * Guardas de formato: un identificador que no tiene la forma de un ObjectId nunca llega a Mongo, así que no hay
 * `CastError` ni 500; quien llama traduce el `null` en su 404.
 */
export function toLinkObjectId(linkId: string): Types.ObjectId | null {
  return isLinkId(linkId) ? new Types.ObjectId(linkId) : null;
}

export function toGroupObjectId(groupId: string): Types.ObjectId | null {
  return isGroupId(groupId) ? new Types.ObjectId(groupId) : null;
}

export function toUserObjectId(userId: string): Types.ObjectId | null {
  return isUserId(userId) ? new Types.ObjectId(userId) : null;
}

/** `_id` de una relación (`group_links` o `user_links`), la mitad del cursor de paginación. Misma forma que los demás. */
export function toRelationObjectId(relationId: string): Types.ObjectId | null {
  return isLinkId(relationId) ? new Types.ObjectId(relationId) : null;
}
