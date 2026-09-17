import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryUserRepository } from '../../users/application/testing/in-memory-user.repository';
import { UsersFacade } from '../../users/application/users.facade';
import { UserNotFound } from '../../users/domain/errors';
import type { Clock } from '../domain/clock';
import { EmailTaken } from '../domain/errors';
import { UsersFacadeUserAccounts } from './users-facade-user-accounts';

// Adaptador USER_ACCOUNTS sobre UsersFacade (D1 de auth-users), con el repositorio en memoria de `users`.

class FixedClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

const REGISTERED_AT = new Date('2026-09-17T10:00:00.000Z');
const CHANGED_AT = new Date('2026-09-18T09:30:00.000Z');
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

describe('UsersFacadeUserAccounts', () => {
  let clock: FixedClock;
  let accounts: UsersFacadeUserAccounts;

  beforeEach(() => {
    clock = new FixedClock(REGISTERED_AT);
    accounts = new UsersFacadeUserAccounts(
      new UsersFacade(new InMemoryUserRepository(), clock),
    );
  });

  it('creates an account and finds its credentials, auth state and profile', async () => {
    const profile = await accounts.createWithPassword({
      email: ' Ana@Example.com',
      passwordHash: HASH,
      displayName: 'Ana',
    });

    expect(profile.email).toBe('ana@example.com');
    expect(await accounts.findCredentialsByEmail('ANA@example.com')).toEqual({
      userId: profile.id,
      email: 'ana@example.com',
      passwordHash: HASH,
    });
    expect(await accounts.getAuthState(profile.id)).toEqual({
      userId: profile.id,
      passwordChangedAt: REGISTERED_AT,
    });
    expect(await accounts.getProfile(profile.id)).toEqual(profile);
  });

  it('translates a duplicated email to EmailTaken of the auth domain', async () => {
    await accounts.createWithPassword({
      email: 'ana@example.com',
      passwordHash: HASH,
      displayName: 'Ana',
    });

    await expect(
      accounts.createWithPassword({
        email: 'ANA@example.com',
        passwordHash: HASH,
        displayName: 'Otra',
      }),
    ).rejects.toBeInstanceOf(EmailTaken);
  });

  it('sets the password hash and moves passwordChangedAt', async () => {
    const { id } = await accounts.createWithPassword({
      email: 'ana@example.com',
      passwordHash: HASH,
      displayName: 'Ana',
    });
    clock.current = CHANGED_AT;

    await accounts.setPasswordHash(id, '$argon2id$new');

    expect(await accounts.getAuthState(id)).toEqual({
      userId: id,
      passwordChangedAt: CHANGED_AT,
    });
    expect((await accounts.findCredentialsByEmail('ana@example.com'))?.passwordHash).toBe(
      '$argon2id$new',
    );
  });

  it('returns null for unknown users and keeps UserNotFound when setting their hash', async () => {
    expect(await accounts.findCredentialsByEmail('nadie@example.com')).toBeNull();
    expect(await accounts.getAuthState('user-404')).toBeNull();
    expect(await accounts.getProfile('user-404')).toBeNull();
    await expect(
      accounts.setPasswordHash('user-404', HASH),
    ).rejects.toBeInstanceOf(UserNotFound);
  });
});
