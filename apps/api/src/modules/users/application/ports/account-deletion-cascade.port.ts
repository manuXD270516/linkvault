// Puerto de la cascada de borrado de cuenta (D4/D11, ADR-033). Application orquesta; infrastructure escribe.

export const ACCOUNT_DELETION_CASCADE = Symbol('ACCOUNT_DELETION_CASCADE');

export interface AccountDeletionCascade {
  /**
   * Borra datos personales, desprende grupos y elimina el usuario en una txn. Tras confirmar, borra el prefijo S3
   * `userId/`. Lanza `SoleOwnerWithMembers` si el ownership bloquea (sin mutar).
   */
  execute(userId: string): Promise<void>;
}
