import { describe, expect, it } from 'vitest';
import { EmailAlreadyRegistered } from '../../domain/errors';
import { createUser } from '../../domain/user';
import { InMemoryUserRepository } from './in-memory-user.repository';

const now = new Date('2026-09-17T10:00:00.000Z');
const later = new Date('2026-09-18T10:00:00.000Z');

function newUser(email = 'ana@example.com') {
  return createUser({
    email,
    passwordHash: '$argon2id$hash',
    displayName: 'Ana',
    now,
  });
}

describe('InMemoryUserRepository', () => {
  it('creates a user with an id and finds it by email and id', async () => {
    const repository = new InMemoryUserRepository();

    const created = await repository.create(newUser());

    expect(created.id).toEqual(expect.any(String));
    expect(await repository.findByEmail('ana@example.com')).toEqual(created);
    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('rejects a second user with the same normalized email', async () => {
    const repository = new InMemoryUserRepository();
    await repository.create(newUser('ana@example.com'));

    await expect(
      repository.create(newUser('ANA@example.com')),
    ).rejects.toBeInstanceOf(EmailAlreadyRegistered);
    expect(repository.size).toBe(1);
  });

  it('returns null for unknown users', async () => {
    const repository = new InMemoryUserRepository();

    expect(await repository.findByEmail('nadie@example.com')).toBeNull();
    expect(await repository.findById('missing')).toBeNull();
    expect(
      await repository.updateProfile('missing', { redactName: true }),
    ).toBeNull();
    expect(await repository.setPasswordHash('missing', 'h', later)).toBe(false);
  });

  it('updates only the sent profile fields', async () => {
    const repository = new InMemoryUserRepository();
    const created = await repository.create(newUser());

    const updated = await repository.updateProfile(created.id, {
      outputLanguage: 'en',
    });

    expect(updated?.profile).toEqual({
      ...created.profile,
      outputLanguage: 'en',
    });
    expect(await repository.findById(created.id)).toEqual(updated);
  });

  it('sets the password hash and passwordChangedAt', async () => {
    const repository = new InMemoryUserRepository();
    const created = await repository.create(newUser());

    expect(
      await repository.setPasswordHash(created.id, 'new-hash', later),
    ).toBe(true);

    expect(await repository.findById(created.id)).toMatchObject({
      passwordHash: 'new-hash',
      passwordChangedAt: later,
      createdAt: now,
    });
  });

  it('does not leak internal state through returned objects', async () => {
    const repository = new InMemoryUserRepository();
    const created = await repository.create(newUser());

    (created.profile as { displayName: string }).displayName = 'Mutated';

    expect((await repository.findById(created.id))?.profile.displayName).toBe(
      'Ana',
    );
  });
});
