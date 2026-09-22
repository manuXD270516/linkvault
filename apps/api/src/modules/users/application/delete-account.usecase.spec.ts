import { describe, expect, it, vi } from 'vitest';
import {
  InvalidAccountPassword,
  SoleOwnerWithMembers,
  UserNotFound,
} from '../domain/errors';
import { createUser } from '../domain/user';
import { DeleteAccount } from './delete-account.usecase';
import type { AccountDeletionCascade } from './ports/account-deletion-cascade.port';
import type { AccountPasswordVerifier } from './ports/account-password-verifier.port';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';

const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c2FsdA$aGFzaA';
const PASSWORD = 'correct-horse-battery';
const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('DeleteAccount', () => {
  it('rejects a wrong password without running the cascade', async () => {
    const users = new InMemoryUserRepository();
    const user = await users.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: HASH,
        displayName: 'Ana',
        now: NOW,
      }),
    );
    const cascade: AccountDeletionCascade = {
      execute: vi.fn(),
    };
    const passwords: AccountPasswordVerifier = {
      verify: vi.fn().mockResolvedValue(false),
    };
    const useCase = new DeleteAccount(users, passwords, cascade);

    await expect(
      useCase.execute(user.id, 'wrong-password'),
    ).rejects.toBeInstanceOf(InvalidAccountPassword);
    expect(cascade.execute).not.toHaveBeenCalled();
  });

  it('propagates SoleOwnerWithMembers from the cascade', async () => {
    const users = new InMemoryUserRepository();
    const user = await users.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: HASH,
        displayName: 'Ana',
        now: NOW,
      }),
    );
    const cascade: AccountDeletionCascade = {
      execute: vi.fn().mockRejectedValue(new SoleOwnerWithMembers()),
    };
    const passwords: AccountPasswordVerifier = {
      verify: vi.fn().mockResolvedValue(true),
    };
    const useCase = new DeleteAccount(users, passwords, cascade);

    await expect(useCase.execute(user.id, PASSWORD)).rejects.toBeInstanceOf(
      SoleOwnerWithMembers,
    );
  });

  it('runs the cascade when the password matches', async () => {
    const users = new InMemoryUserRepository();
    const user = await users.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: HASH,
        displayName: 'Ana',
        now: NOW,
      }),
    );
    const cascade: AccountDeletionCascade = {
      execute: vi.fn().mockResolvedValue(undefined),
    };
    const passwords: AccountPasswordVerifier = {
      verify: vi.fn().mockResolvedValue(true),
    };
    const useCase = new DeleteAccount(users, passwords, cascade);

    await expect(useCase.execute(user.id, PASSWORD)).resolves.toBeUndefined();
    expect(cascade.execute).toHaveBeenCalledWith(user.id);
  });

  it('rejects an unknown user', async () => {
    const users = new InMemoryUserRepository();
    const cascade: AccountDeletionCascade = { execute: vi.fn() };
    const passwords: AccountPasswordVerifier = { verify: vi.fn() };
    const useCase = new DeleteAccount(users, passwords, cascade);

    await expect(
      useCase.execute('66e9a00000000000000000ff', PASSWORD),
    ).rejects.toBeInstanceOf(UserNotFound);
    expect(cascade.execute).not.toHaveBeenCalled();
  });
});
