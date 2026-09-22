// Puerto del vault de claves BYOK (design-v0.2 §4.1, ADR-032 D2). Sin Nest ni mongoose.

/** Texto plano demasiado corto para cifrar (mínimo del PUT / ai-byok). */
export class SecretTooShort extends Error {
  override readonly name = 'SecretTooShort';

  constructor(readonly minLength: number) {
    super(`Secret must be at least ${minLength} characters`);
  }
}

/** Vault sin clave configurada o con material inválido (ADR-032 D4). */
export class VaultUnavailable extends Error {
  override readonly name = 'VaultUnavailable';

  constructor(detail = 'AI vault key is not configured') {
    super(detail);
  }
}

/** Fallo al descifrar: ciphertext corrupto o clave distinta. */
export class VaultDecryptFailed extends Error {
  override readonly name = 'VaultDecryptFailed';

  constructor() {
    super('Failed to decrypt vault ciphertext');
  }
}

/**
 * Cifrado simétrico de secretos BYOK. La implementación usa secretbox con `AI_VAULT_KEY`.
 * `isAvailable()` es false fuera de producción sin clave: el PUT responde `vault_unavailable`.
 */
export interface SecretVault {
  /** `true` si hay clave de 32 bytes y se puede cifrar/descifrar. */
  isAvailable(): boolean;
  /** Cifra el plaintext. Rechaza con `VaultUnavailable` o `SecretTooShort`. */
  encrypt(plaintext: string): Promise<Uint8Array>;
  /** Descifrado solo en memoria al construir el provider de esa ejecución. */
  decrypt(ciphertext: Uint8Array): Promise<string>;
}
