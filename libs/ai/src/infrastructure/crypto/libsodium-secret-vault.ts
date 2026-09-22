import { secretbox } from '@noble/ciphers/salsa.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { AI_BYOK_API_KEY_MIN_LENGTH } from '@linkvault/shared';
import {
  SecretTooShort,
  VaultDecryptFailed,
  VaultUnavailable,
  type SecretVault,
} from '../../domain/ports/secret-vault.port';

// secretbox (XSalsa20-Poly1305) compatible con libsodium `crypto_secretbox_easy` (ADR-032 D2).
// Formato persistido: nonce (24) ‖ sealed. La clave nunca se loguea ni se serializa.

export const AI_VAULT_KEY_BYTES = 32;
export const AI_VAULT_NONCE_BYTES = 24;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export interface LibsodiumSecretVaultOptions {
  /**
   * Clave de 32 bytes ya decodificada de `AI_VAULT_KEY` (base64).
   * `undefined` → vault no disponible (típico fuera de producción).
   */
  vaultKey: Uint8Array | undefined;
}

/**
 * Valida y copia una clave de vault. Devuelve `undefined` si falta o no tiene 32 bytes.
 * Nunca lanza con el valor recibido en el mensaje.
 */
export function parseVaultKey(
  raw: Uint8Array | undefined,
): Uint8Array | undefined {
  if (raw === undefined) return undefined;
  if (raw.byteLength !== AI_VAULT_KEY_BYTES) return undefined;
  return Uint8Array.from(raw);
}

/** Decodifica `AI_VAULT_KEY` en base64 a 32 bytes, o `undefined` si falta / es inválida. */
export function decodeVaultKeyFromBase64(
  value: string | undefined,
): Uint8Array | undefined {
  if (value === undefined || value === '') return undefined;
  try {
    const decoded = Buffer.from(value, 'base64');
    if (decoded.byteLength !== AI_VAULT_KEY_BYTES) return undefined;
    return new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  } catch {
    return undefined;
  }
}

export class LibsodiumSecretVault implements SecretVault {
  readonly #key: Uint8Array | undefined;

  constructor(options: LibsodiumSecretVaultOptions) {
    this.#key = parseVaultKey(options.vaultKey);
  }

  isAvailable(): boolean {
    return this.#key !== undefined;
  }

  async encrypt(plaintext: string): Promise<Uint8Array> {
    const key = this.requireKey();
    if (plaintext.length < AI_BYOK_API_KEY_MIN_LENGTH) {
      throw new SecretTooShort(AI_BYOK_API_KEY_MIN_LENGTH);
    }
    const nonce = randomBytes(AI_VAULT_NONCE_BYTES);
    const sealed = secretbox(key, nonce).seal(textEncoder.encode(plaintext));
    const out = new Uint8Array(AI_VAULT_NONCE_BYTES + sealed.byteLength);
    out.set(nonce, 0);
    out.set(sealed, AI_VAULT_NONCE_BYTES);
    return out;
  }

  async decrypt(ciphertext: Uint8Array): Promise<string> {
    const key = this.requireKey();
    if (ciphertext.byteLength <= AI_VAULT_NONCE_BYTES) {
      throw new VaultDecryptFailed();
    }
    const nonce = ciphertext.subarray(0, AI_VAULT_NONCE_BYTES);
    const sealed = ciphertext.subarray(AI_VAULT_NONCE_BYTES);
    try {
      const opened = secretbox(key, nonce).open(sealed);
      return textDecoder.decode(opened);
    } catch {
      throw new VaultDecryptFailed();
    }
  }

  private requireKey(): Uint8Array {
    if (this.#key === undefined) throw new VaultUnavailable();
    return this.#key;
  }
}
