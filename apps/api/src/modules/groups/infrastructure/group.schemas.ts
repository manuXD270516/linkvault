import { mongo, Schema, Types } from 'mongoose';
import { isGroupId, isUserId } from '../domain/identifier';
import { GROUP_ROLES } from '../domain/membership';

// Colecciones del módulo `groups` (D1). `groups` no guarda `ownerId`: la propiedad vive en la membresía con rol `owner`,
// así que no hay dos fuentes de verdad. El índice único de `inviteCode` es lo que garantiza que dos grupos no compartan
// código (el generador es puro y no consulta nada); el único de `(groupId, userId)` cierra la carrera de dos uniones
// simultáneas; el único parcial `one_owner_per_group` asegura como mucho un owner por grupo (ADR-025 §2).
// `bufferCommands: false`: sin conexión, una operación falla enseguida en lugar de quedar en cola.

export const GROUP_MODEL_NAME = 'Group';
export const GROUPS_COLLECTION = 'groups';
export const GROUP_MEMBER_MODEL_NAME = 'GroupMember';
export const GROUP_MEMBERS_COLLECTION = 'group_members';

/**
 * `keyPattern` de los índices únicos (ADR-025 §4). Son las mismas constantes con las que se declaran los índices y con
 * las que `duplicateKeyIs` reconoce qué índice rechazó una escritura: el índice de owner y el de membresía comparten el
 * campo `groupId`, así que mirar si el `keyPattern` "incluye" un campo no los distingue.
 */
export const INVITE_KEY: Readonly<Record<string, 1>> = { inviteCode: 1 };
export const MEMBERSHIP_KEY: Readonly<Record<string, 1>> = {
  groupId: 1,
  userId: 1,
};
export const OWNER_KEY: Readonly<Record<string, 1>> = { groupId: 1 };

/** Nombre explícito del índice de owner, para reconocerlo en `getIndexes()`, en el log de arranque y en el RUNBOOK. */
export const ONE_OWNER_PER_GROUP_INDEX = 'one_owner_per_group';

const DUPLICATE_KEY = 11_000;

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
groupSchema.index({ ...INVITE_KEY }, { unique: true });

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
groupMemberSchema.index({ ...MEMBERSHIP_KEY }, { unique: true });
// Como mucho un owner por grupo, también frente a caminos de escritura futuros (ADR-025 §2). "Al menos uno" es de la
// transacción de la transferencia. Mongo comprueba la unicidad por sentencia, así que transferir degrada antes de promover.
groupMemberSchema.index(
  { ...OWNER_KEY },
  {
    unique: true,
    partialFilterExpression: { role: 'owner' },
    name: ONE_OWNER_PER_GROUP_INDEX,
  },
);
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

/**
 * `true` si `error` es una clave duplicada del índice cuyo `keyPattern` es exactamente `pattern` (mismos campos, en el
 * mismo orden y con el mismo sentido). No se parsea `errmsg`, que no es contrato (ADR-025 §4).
 */
export function duplicateKeyIs(
  error: unknown,
  pattern: Readonly<Record<string, 1 | -1>>,
): boolean {
  if (
    !(error instanceof mongo.MongoServerError) ||
    error.code !== DUPLICATE_KEY
  ) {
    return false;
  }
  const actual: unknown = error['keyPattern'];
  if (typeof actual !== 'object' || actual === null) {
    return false;
  }
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(pattern);
  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([field, direction], index) => {
      const entry = actualEntries[index];
      return (
        entry !== undefined && entry[0] === field && entry[1] === direction
      );
    })
  );
}
