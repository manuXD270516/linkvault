import { Schema, Types } from 'mongoose';
import { APPLICATION_VISIBILITIES } from '../domain/application.entity';
import { APPLICATION_STATUSES } from '../domain/application-status';
import { isApplicationId, isLinkId, isUserId } from '../domain/identifier';

// Colecciones del módulo `applications` (D2 de applications-tracking).
//
// - `applications`: una por persona y link, garantizado por el índice único `(userId, linkId)`, que también cierra la
//   carrera de dos altas simultáneas (D5). `{ userId, updatedAt, _id }` ordena el tablero y `{ linkId, visibility,
//   userId }` sirve los estados compartidos de una página de tarjetas en una sola consulta (D6).
// - `application_events`: el historial, con `userId` duplicado para filtrarlo por dueño sin leer la postulación, e
//   índice `{ applicationId, at, _id }` para leerlo en orden y borrarlo entero al dejar de seguir.
//
// `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar en cola. Ninguna colección
// guarda un `groupId`: la visibilidad en un grupo se deriva en cada lectura (ADR-024 §6).

export const APPLICATION_MODEL_NAME = 'Application';
export const APPLICATIONS_COLLECTION = 'applications';
export const APPLICATION_EVENT_MODEL_NAME = 'ApplicationEvent';
export const APPLICATION_EVENTS_COLLECTION = 'application_events';

/** `keyPattern` del índice único; con él `duplicateKeyIs` reconoce la carrera de dos altas. */
export const TRACKING_KEY: Readonly<Record<string, 1>> = {
  userId: 1,
  linkId: 1,
};

export interface ApplicationDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  linkId: Types.ObjectId;
  status: (typeof APPLICATION_STATUSES)[number];
  stageLabel?: string;
  visibility: (typeof APPLICATION_VISIBILITIES)[number];
  notes: string;
  appliedAt?: Date;
  statusChangedAt: Date;
  /**
   * Sin campo de puntuación (D11 / ADR-030 §5): `fitScore` / `fitScoreDegraded` se derivan al leer del análisis, nunca
   * se persisten aquí.
   */
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ApplicationEventDocument {
  _id: Types.ObjectId;
  applicationId: Types.ObjectId;
  userId: Types.ObjectId;
  from?: (typeof APPLICATION_STATUSES)[number];
  to: (typeof APPLICATION_STATUSES)[number];
  fromStageLabel?: string;
  stageLabel?: string;
  at: Date;
}

const schemaOptions = {
  bufferCommands: false,
  versionKey: false,
  strict: true,
} as const;

export const applicationSchema = new Schema<ApplicationDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    linkId: { type: Schema.Types.ObjectId, required: true },
    status: { type: String, required: true, enum: APPLICATION_STATUSES },
    stageLabel: { type: String },
    visibility: {
      type: String,
      required: true,
      enum: APPLICATION_VISIBILITIES,
    },
    // `default` y no `required`: la cadena vacía es una nota válida (sin notas) y `required` la rechazaría.
    notes: { type: String, default: '' },
    appliedAt: { type: Date },
    statusChangedAt: { type: Date, required: true },
    version: { type: Number, required: true, min: 1 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: APPLICATIONS_COLLECTION },
);

// Una postulación por persona y link, también ante dos altas simultáneas (D5).
applicationSchema.index({ ...TRACKING_KEY }, { unique: true });
// Tablero: las de una persona, de la cambiada más recientemente a la más antigua.
applicationSchema.index({ userId: 1, updatedAt: -1, _id: -1 });
// Estados compartidos de una página de tarjetas: links, visibilidad y miembros, en una consulta (D6).
applicationSchema.index({ linkId: 1, visibility: 1, userId: 1 });

export const applicationEventSchema = new Schema<ApplicationEventDocument>(
  {
    applicationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    from: { type: String, enum: APPLICATION_STATUSES },
    to: { type: String, required: true, enum: APPLICATION_STATUSES },
    fromStageLabel: { type: String },
    stageLabel: { type: String },
    at: { type: Date, required: true },
  },
  { ...schemaOptions, collection: APPLICATION_EVENTS_COLLECTION },
);

// Historial en orden y borrado entero al dejar de seguir.
applicationEventSchema.index({ applicationId: 1, at: 1, _id: 1 });

/**
 * Guardas de formato: un identificador que no tiene la forma de un ObjectId nunca llega a Mongo, así que no hay
 * `CastError` ni 500; quien llama traduce el `null` en el 404 uniforme.
 */
export function toApplicationObjectId(id: string): Types.ObjectId | null {
  return isApplicationId(id) ? new Types.ObjectId(id) : null;
}

export function toLinkObjectId(id: string): Types.ObjectId | null {
  return isLinkId(id) ? new Types.ObjectId(id) : null;
}

export function toUserObjectId(id: string): Types.ObjectId | null {
  return isUserId(id) ? new Types.ObjectId(id) : null;
}
