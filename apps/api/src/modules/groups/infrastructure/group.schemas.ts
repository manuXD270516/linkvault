import { Schema, Types } from 'mongoose';
import { isGroupId, isUserId } from '../domain/identifier';
import { GROUP_ROLES } from '../domain/membership';

// Colecciones del módulo `groups` (D1). `groups` no guarda `ownerId`: la propiedad vive en la membresía con rol `owner`,
// así que no hay dos fuentes de verdad. El índice único de `inviteCode` es lo que garantiza que dos grupos no compartan
// código (el generador es puro y no consulta nada); el único de `(groupId, userId)` cierra la carrera de dos uniones
// simultáneas. `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar en cola.

export const GROUP_MODEL_NAME = 'Group';
export const GROUPS_COLLECTION = 'groups';
export const GROUP_MEMBER_MODEL_NAME = 'GroupMember';
export const GROUP_MEMBERS_COLLECTION = 'group_members';

export interface GroupDocument {
  _id: Types.ObjectId;
  name: string;
  /** Único entre todos los grupos; siempre normalizado (mayúsculas, sin espacios). */
  inviteCode: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupMemberDocument {
  _id: Types.ObjectId;
  groupId: Types.ObjectId;
  userId: Types.ObjectId;
  role: (typeof GROUP_ROLES)[number];
  joinedAt: Date;
}

const schemaOptions = {
  bufferCommands: false,
  versionKey: false,
  strict: true,
} as const;

export const groupSchema = new Schema<GroupDocument>(
  {
    name: { type: String, required: true },
    inviteCode: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: GROUPS_COLLECTION },
);

// Unicidad del código y búsqueda por código al unirse.
groupSchema.index({ inviteCode: 1 }, { unique: true });

export const groupMemberSchema = new Schema<GroupMemberDocument>(
  {
    groupId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true },
    role: { type: String, required: true, enum: GROUP_ROLES },
    joinedAt: { type: Date, required: true },
  },
  { ...schemaOptions, collection: GROUP_MEMBERS_COLLECTION },
);

// Una sola membresía por persona y grupo: dos uniones concurrentes no pueden ganar ambas (D4).
groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true });
// Lista de grupos del usuario, por `joinedAt` descendente.
groupMemberSchema.index({ userId: 1, joinedAt: -1 });
// Lista de miembros del grupo, por `joinedAt` ascendente.
groupMemberSchema.index({ groupId: 1, joinedAt: 1 });

/**
 * Guarda de formato (D2): un identificador que no tiene la forma de un ObjectId nunca llega a Mongo, así que no hay
 * `CastError` ni 500; quien llama traduce el `null` en el 404 uniforme.
 */
export function toGroupObjectId(groupId: string): Types.ObjectId | null {
  return isGroupId(groupId) ? new Types.ObjectId(groupId) : null;
}

export function toUserObjectId(userId: string): Types.ObjectId | null {
  return isUserId(userId) ? new Types.ObjectId(userId) : null;
}
