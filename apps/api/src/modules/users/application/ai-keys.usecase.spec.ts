import {
  InMemoryUserAiKeysRepository,
  LibsodiumSecretVault,
} from '@linkvault/ai';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiVaultUnavailable } from '../domain/errors';
import type { Clock } from './ports/clock.port';
import { DeleteAllMyAiKeys } from './delete-all-my-ai-keys.usecase';
import { DeleteMyAiKey } from './delete-my-ai-key.usecase';
import { ListMyAiKeys } from './list-my-ai-keys.usecase';
import { UpsertMyAiKey } from './upsert-my-ai-key.usecase';

// Casos de uso BYOK (tarea 1.3): vault + repo en memoria. Sin HTTP ni Mongo.

const ANA = '66e9a0000000000000000a01';
const VAULT_KEY = new Uint8Array(32).fill(9);
const API_KEY = 'sk-test-openai-key-16+';
const KEY_HINT = API_KEY.slice(-4);

class FixedClock implements Clock {
  constructor(private readonly instant: Date) {}
  now(): Date {
    return this.instant;
  }
}

describe('BYOK ai-keys use cases', () => {
  const now = new Date('2026-09-22T12:00:00.000Z');
  let vault: LibsodiumSecretVault;
  let keys: InMemoryUserAiKeysRepository;
  let upsert: UpsertMyAiKey;
  let list: ListMyAiKeys;
  let remove: DeleteMyAiKey;
  let removeAll: DeleteAllMyAiKeys;

  beforeEach(() => {
    vault = new LibsodiumSecretVault({ vaultKey: VAULT_KEY });
    keys = new InMemoryUserAiKeysRepository();
    const clock = new FixedClock(now);
    upsert = new UpsertMyAiKey(vault, keys, clock);
    list = new ListMyAiKeys(keys);
    remove = new DeleteMyAiKey(keys);
    removeAll = new DeleteAllMyAiKeys(keys);
  });

  it('upserts, lists hint only, and never returns plaintext', async () => {
    const view = await upsert.execute(ANA, 'openai', { apiKey: API_KEY });
    expect(view).toEqual({
      vendor: 'openai',
      keyHint: KEY_HINT,
      updatedAt: now.toISOString(),
    });
    expect(JSON.stringify(view)).not.toContain(API_KEY);

    const listed = await list.execute(ANA);
    expect(listed.keys).toEqual([view]);
    expect(JSON.stringify(listed)).not.toContain(API_KEY);

    const record = await keys.findRecord(ANA, 'openai');
    expect(record).not.toBeNull();
    if (record === null) {
      return;
    }
    expect(record.ciphertext).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(record.ciphertext).toString('utf8')).not.toContain(
      API_KEY,
    );
  });

  it('revokes a vendor so GET no longer lists it', async () => {
    await upsert.execute(ANA, 'anthropic', { apiKey: 'anthropic-secret-key' });
    await remove.execute(ANA, 'anthropic');
    expect(await list.execute(ANA)).toEqual({ keys: [] });
  });

  it('deletes all keys for the user', async () => {
    await upsert.execute(ANA, 'openai', { apiKey: API_KEY });
    await upsert.execute(ANA, 'openrouter', {
      apiKey: 'or-secret-key-xxxxxx',
    });
    await removeAll.execute(ANA);
    expect(await list.execute(ANA)).toEqual({ keys: [] });
  });

  it('responds vault_unavailable when the vault has no key', async () => {
    const unavailable = new LibsodiumSecretVault({ vaultKey: undefined });
    const useCase = new UpsertMyAiKey(
      unavailable,
      keys,
      new FixedClock(now),
    );
    await expect(
      useCase.execute(ANA, 'openai', { apiKey: API_KEY }),
    ).rejects.toBeInstanceOf(AiVaultUnavailable);
    expect(await list.execute(ANA)).toEqual({ keys: [] });
  });
});
