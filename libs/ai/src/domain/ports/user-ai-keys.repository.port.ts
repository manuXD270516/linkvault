import type { AiVendor } from '@linkvault/shared';

// Persistencia de claves BYOK cifradas (ADR-032 D1, D5). Sin Nest ni mongoose: solo tipos y el puerto.

/**
 * Sesión de la misma unidad de commit que el borrado de cuenta (p. ej. `ClientSession` de Mongoose).
 * Opaca a propósito: el dominio no importa el driver.
 */
export type UserAiKeysWriteSession = object;

/** Vista HTTP / listado: sin ciphertext. */
export interface UserAiKeyView {
  vendor: AiVendor;
  keyHint: string;
  updatedAt: Date;
}

/** Fila completa para descifrar al construir el provider. */
export interface UserAiKeyRecord extends UserAiKeyView {
  userId: string;
  ciphertext: Uint8Array;
}

export interface UpsertUserAiKeyInput {
  userId: string;
  vendor: AiVendor;
  ciphertext: Uint8Array;
  keyHint: string;
  updatedAt?: Date;
}

/**
 * Colección `user_ai_keys`, índice único `(userId, vendor)`.
 * `deleteAllKeysForUser` acepta `session` para la misma txn del borrado de cuenta (D5).
 */
export interface UserAiKeysRepository {
  upsert(input: UpsertUserAiKeyInput): Promise<UserAiKeyView>;
  listByUser(userId: string): Promise<UserAiKeyView[]>;
  /** Con ciphertext para el factory BYOK. */
  listRecordsByUser(userId: string): Promise<UserAiKeyRecord[]>;
  findRecord(
    userId: string,
    vendor: AiVendor,
  ): Promise<UserAiKeyRecord | null>;
  delete(userId: string, vendor: AiVendor): Promise<boolean>;
  /**
   * Borra todas las claves del usuario. Con `session`, participa en la misma unidad de commit
   * que el borrado de cuenta (sin EventEmitter).
   */
  deleteAllKeysForUser(
    userId: string,
    session?: UserAiKeysWriteSession,
  ): Promise<number>;
}
