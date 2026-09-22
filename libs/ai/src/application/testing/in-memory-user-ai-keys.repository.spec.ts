import { describe, expect, it } from 'vitest';
import { InMemoryUserAiKeysRepository } from '../../application/testing/in-memory-user-ai-keys.repository';

const CIPHER_A = new Uint8Array([1, 2, 3, 4]);
const CIPHER_B = new Uint8Array([9, 8, 7, 6]);

describe('InMemoryUserAiKeysRepository', () => {
  it('upserts by userId+vendor and lists views without ciphertext', async () => {
    const repo = new InMemoryUserAiKeysRepository();
    const updatedAt = new Date('2026-09-22T10:00:00.000Z');

    const view = await repo.upsert({
      userId: 'ana',
      vendor: 'openai',
      ciphertext: CIPHER_A,
      keyHint: '9abc',
      updatedAt,
    });

    expect(view).toEqual({
      vendor: 'openai',
      keyHint: '9abc',
      updatedAt,
    });
    expect(await repo.listByUser('ana')).toEqual([view]);
    expect(JSON.stringify(await repo.listByUser('ana'))).not.toContain(
      String.fromCharCode(...CIPHER_A),
    );
  });

  it('replaces ciphertext on the same vendor and keeps the unique pair', async () => {
    const repo = new InMemoryUserAiKeysRepository();
    await repo.upsert({
      userId: 'ana',
      vendor: 'anthropic',
      ciphertext: CIPHER_A,
      keyHint: 'old1',
    });
    await repo.upsert({
      userId: 'ana',
      vendor: 'anthropic',
      ciphertext: CIPHER_B,
      keyHint: 'new2',
    });

    const record = await repo.findRecord('ana', 'anthropic');
    expect(record?.keyHint).toBe('new2');
    expect(record?.ciphertext).toEqual(CIPHER_B);
    expect(await repo.listByUser('ana')).toHaveLength(1);
  });

  it('deleteAllKeysForUser removes every vendor and forwards the session', async () => {
    const repo = new InMemoryUserAiKeysRepository();
    await repo.upsert({
      userId: 'ana',
      vendor: 'openai',
      ciphertext: CIPHER_A,
      keyHint: 'aaaa',
    });
    await repo.upsert({
      userId: 'ana',
      vendor: 'openrouter',
      ciphertext: CIPHER_B,
      keyHint: 'bbbb',
    });
    await repo.upsert({
      userId: 'beto',
      vendor: 'openai',
      ciphertext: CIPHER_A,
      keyHint: 'cccc',
    });
    const session = { id: 'txn' };

    await expect(repo.deleteAllKeysForUser('ana', session)).resolves.toBe(2);

    expect(await repo.listByUser('ana')).toEqual([]);
    expect(await repo.listByUser('beto')).toHaveLength(1);
    expect(repo.deleteAllSessions).toEqual([session]);
  });

  it('delete removes a single vendor', async () => {
    const repo = new InMemoryUserAiKeysRepository();
    await repo.upsert({
      userId: 'ana',
      vendor: 'openai',
      ciphertext: CIPHER_A,
      keyHint: 'hint',
    });

    await expect(repo.delete('ana', 'openai')).resolves.toBe(true);
    await expect(repo.delete('ana', 'openai')).resolves.toBe(false);
  });
});
