import { describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import { SecretTooShort, VaultUnavailable } from '../../domain/ports/secret-vault.port';
import {
  AI_VAULT_KEY_BYTES,
  decodeVaultKeyFromBase64,
  LibsodiumSecretVault,
} from './libsodium-secret-vault';

const KEY = new Uint8Array(AI_VAULT_KEY_BYTES).fill(7);
const PLAINTEXT = 'sk-test-anthropic-key-xyz';

describe('LibsodiumSecretVault', () => {
  it('round-trips a secret and keeps distinct ciphertexts', async () => {
    const vault = new LibsodiumSecretVault({ vaultKey: KEY });

    const a = await vault.encrypt(PLAINTEXT);
    const b = await vault.encrypt(PLAINTEXT);

    expect(a).not.toEqual(b);
    await expect(vault.decrypt(a)).resolves.toBe(PLAINTEXT);
    await expect(vault.decrypt(b)).resolves.toBe(PLAINTEXT);
  });

  it('rejects a short secret before encrypting', async () => {
    const vault = new LibsodiumSecretVault({ vaultKey: KEY });

    await expect(vault.encrypt('short')).rejects.toBeInstanceOf(SecretTooShort);
  });

  it('is unavailable without a vault key and rejects encrypt', async () => {
    const vault = new LibsodiumSecretVault({ vaultKey: undefined });

    expect(vault.isAvailable()).toBe(false);
    await expect(vault.encrypt(PLAINTEXT)).rejects.toBeInstanceOf(
      VaultUnavailable,
    );
  });

  it('treats a key that is not 32 bytes as unavailable', () => {
    const vault = new LibsodiumSecretVault({
      vaultKey: new Uint8Array(16).fill(1),
    });

    expect(vault.isAvailable()).toBe(false);
  });

  it('does not expose the vault key when the instance is inspected', () => {
    const vault = new LibsodiumSecretVault({ vaultKey: KEY });

    expect(JSON.stringify(vault)).not.toContain(String.fromCharCode(...KEY));
    expect(inspect(vault, { depth: 5 })).not.toContain('777777');
  });

  it('decodeVaultKeyFromBase64 accepts exactly 32 decoded bytes', () => {
    const encoded = Buffer.from(KEY).toString('base64');
    expect(decodeVaultKeyFromBase64(encoded)).toEqual(KEY);
    expect(decodeVaultKeyFromBase64(undefined)).toBeUndefined();
    expect(decodeVaultKeyFromBase64('not-base64!!!')).toBeUndefined();
    expect(
      decodeVaultKeyFromBase64(Buffer.from([1, 2, 3]).toString('base64')),
    ).toBeUndefined();
  });
});
