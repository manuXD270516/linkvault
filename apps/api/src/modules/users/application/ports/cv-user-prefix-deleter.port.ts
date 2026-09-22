// Puerto para borrar todos los objetos CV bajo `userId/` (D4/D11). Distinto de `CV_FILE_STORE` (solo `put`).

export const CV_USER_PREFIX_DELETER = Symbol('CV_USER_PREFIX_DELETER');

export interface CvUserPrefixDeleter {
  /** Borra todas las claves con prefijo `userId/`. Idempotente si el prefijo ya está vacío. */
  deleteAllForUser(userId: string): Promise<void>;
}
