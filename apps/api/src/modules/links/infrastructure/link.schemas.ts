import {
  enrichmentFailureReasonSchema,
  platformSchema,
  previewStatusSchema,
  type LastEnrichmentError,
  type Platform,
  type PreviewSources,
  type PreviewStatus,
  type StoredPreview,
} from '@linkvault/shared';
import { Schema, Types } from 'mongoose';
import { isGroupId, isLinkId, isUserId } from '../domain/identifier';
import { previewSourcesSubSchema, previewSubSchema } from './preview.schemas';

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

/**
 * `keyPattern` de los dos índices únicos de `group_links`, con los que `duplicateKeyIs` reconoce cuál rechazó una
 * escritura (ADR-025 §4). Hacen falta los dos porque `share({ publish: true })` puede chocar con cualquiera de ellos y
 * el repositorio los trata distinto (D2 de public-preview-share).
 */
export const GROUP_LINK_KEY: Readonly<Record<string, 1>> = {
  groupId: 1,
  linkId: 1,
};
export const PUBLIC_SLUG_KEY: Readonly<Record<string, 1>> = {
  'publicShare.slug': 1,
};

/** Nombre explícito del índice del slug, para reconocerlo en `getIndexes()` y en el RUNBOOK. */
export const PUBLIC_SLUG_INDEX = 'public_share_slug';

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
  /** Vacante leída de la página, con los campos que la extracción consiguió. Ausente mientras nadie la haya leído. */
  preview?: StoredPreview;
  /** Quién puso cada campo del preview: el extractor que lo produjo o la persona que lo escribió. */
  previewSources?: PreviewSources;
  /** Motivo del último fallo de lectura, sin el cuerpo de la respuesta ni la URL del usuario. */
  lastEnrichmentError?: LastEnrichmentError;
  /** Clave de la copia comprimida de la página. Se lee de aquí; NUNCA se deduce de `previewVersion` (D12). */
  snapshotKey?: string;
  /** Cuándo se pidió leer la oferta. Ausente en los links guardados antes de `link-enrichment`. */
  previewRequestedAt?: Date;
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
  /**
   * Nota de quien lo compartió (D3 de group-comments). Se escribe solo al crear la relación y no se edita; ausente si no
   * la hay. En docs/design.md se llamaba `comment` (ADR-026, "Se aparta de").
   */
  note?: { text: string; createdAt: Date };
  /**
   * Comentarios del link en este grupo y revisión del resumen (D2 de group-comments). Solo los escribe
   * `MongoGroupLinkRepository`, con `$inc` en la transacción del alta o del borrado de un comentario. Un documento
   * anterior a group-comments no los tiene y se lee como 0: no hay migración.
   */
  commentCount?: number;
  commentsRevision?: number;
  /**
   * Enlace público de este link en este grupo (D1 de public-preview-share). Ausente mientras no esté publicado, y
   * también en cualquier relación anterior al change: **no hay backfill**, así que ningún link ya compartido se publica
   * solo. Despublicar lo borra entero con un `$unset`, de modo que el slug se quema.
   */
  publicShare?: { slug: string; publishedBy: Types.ObjectId; publishedAt: Date };
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
    // Forma derivada de `libs/shared`, compartida con el schema del worker (D11).
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
        { _id: false, versionKey: false, strict: true, minimize: false },
      ),
      required: false,
    },
    snapshotKey: { type: String, required: false },
    previewRequestedAt: { type: Date, required: false },
    createdBy: { type: Schema.Types.ObjectId, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  // `minimize: false` solo aquí: un `preview` o un `previewSources` que se quedan vacíos son un dato —"se leyó y no
  // había nada"— y Mongoose, minimizando, los borraría del documento. Las mismas opciones tiene el schema del worker
  // sobre esta colección, y el test tabular de cada lado las compara con la tabla de `libs/shared` (D11).
  { ...schemaOptions, minimize: false, collection: JOB_LINKS_COLLECTION },
);

// Una vacante por clave de dedupe: es lo que cierra la carrera de dos altas simultáneas de la misma URL (D3).
jobLinkSchema.index({ dedupeKey: 1 }, { unique: true });
// Reencolado por estado (`api:backfill-enrichment`, D10): los links de un estado en orden de `_id`, que es por donde el
// comando avanza en tandas. Sin él, rescatar los `pending` de una base con cien mil vacantes sería un escaneo completo.
jobLinkSchema.index({ previewStatus: 1, _id: 1 });

export const groupLinkSchema = new Schema<GroupLinkDocument>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    sharedBy: { type: Schema.Types.ObjectId, required: true },
    sharedAt: { type: Date, required: true },
    note: {
      type: new Schema(
        {
          text: { type: String, required: true },
          createdAt: { type: Date, required: true },
        },
        { _id: false, versionKey: false, strict: true },
      ),
      required: false,
    },
    commentCount: { type: Number, required: false, default: 0 },
    commentsRevision: { type: Number, required: false, default: 0 },
    publicShare: {
      type: new Schema(
        {
          slug: { type: String, required: true },
          publishedBy: { type: Schema.Types.ObjectId, required: true },
          publishedAt: { type: Date, required: true },
        },
        { _id: false, versionKey: false, strict: true },
      ),
      required: false,
    },
  },
  { ...schemaOptions, collection: GROUP_LINKS_COLLECTION },
);

// Un grupo tiene cada link una sola vez: compartir dos veces no duplica ni cambia quién lo compartió (D4).
groupLinkSchema.index({ ...GROUP_LINK_KEY }, { unique: true });
// Listado paginado del grupo. El `_id` desempata: sin él, 50 links guardados en el mismo instante se repetirían o se
// saltarían al pasar de página (D8).
groupLinkSchema.index({ groupId: 1, sharedAt: -1, _id: -1 });
// Reparto de un aviso de enriquecimiento (D9 de link-enrichment): quién puede ver ESE link. Los otros dos índices
// llevan el link en segunda posición, así que no sirven para buscar por link solo; sin este, cada aviso de una
// importación de 50 links sería un escaneo completo de la colección.
groupLinkSchema.index({ linkId: 1 });
// Único **parcial** sobre el slug del enlace público (D2 de public-preview-share): es lo que garantiza la unicidad y lo
// único que cierra la carrera de dos publicaciones simultáneas, sin ninguna consulta previa. Parcial porque la inmensa
// mayoría de las relaciones no tienen `publicShare`, y un índice único a secas las haría chocar todas en `null`.
// Resuelve además la página pública con un solo `findOne`. Los tres índices anteriores NO se tocan.
groupLinkSchema.index(
  { ...PUBLIC_SLUG_KEY },
  {
    unique: true,
    partialFilterExpression: { 'publicShare.slug': { $exists: true } },
    name: PUBLIC_SLUG_INDEX,
  },
);

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
// La otra mitad del reparto de un aviso: quién tiene ESE link en su lista privada.
userLinkSchema.index({ linkId: 1 });

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
