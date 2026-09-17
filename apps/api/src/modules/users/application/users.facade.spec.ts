import { beforeEach, describe, expect, it } from 'vitest';
import { EmailAlreadyRegistered, UserNotFound } from '../domain/errors';
import type { Clock } from './ports/clock.port';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';
import { UsersFacade } from './users.facade';

class FixedClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

const registeredAt = new Date('2026-09-17T10:00:00.000Z');
const changedAt = new Date('2026-09-20T08:15:30.250Z');

describe('UsersFacade', () => {
  let repository: InMemoryUserRepository;
  let clock: FixedClock;
  let facade: UsersFacade;

  beforeEach(() => {
    repository = new InMemoryUserRepository();
    clock = new FixedClock(registeredAt);
    facade = new UsersFacade(repository, clock);
  });

  describe('createWithPassword', () => {
    it('Perfil tras el registro', async () => {
      const profile = await facade.createWithPassword({
        email: '  Ana@Example.com ',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });

      expect(profile).toStrictEqual({
        id: expect.any(String),
        email: 'ana@example.com',
        displayName: 'Ana',
        aiConsent: { externalProviders: false },
        outputLanguage: 'es',
        redactName: false,
        createdAt: '2026-09-17T10:00:00.000Z',
      });
      expect(await repository.findById(profile.id)).toMatchObject({
        passwordHash: '$argon2id$hash',
        passwordChangedAt: registeredAt,
        createdAt: registeredAt,
      });
    });

    it('rejects an email already registered in another case', async () => {
      await facade.createWithPassword({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });

      await expect(
        facade.createWithPassword({
          email: 'ANA@example.com',
          passwordHash: '$argon2id$other',
          displayName: 'Otra',
        }),
      ).rejects.toBeInstanceOf(EmailAlreadyRegistered);
      expect(repository.size).toBe(1);
    });
  });

  describe('findCredentialsByEmail', () => {
    it('normalizes the email and returns id, email and hash', async () => {
      const { id } = await facade.createWithPassword({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });

      expect(await facade.findCredentialsByEmail(' ANA@example.com')).toEqual({
        userId: id,
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
      });
    });

    it('returns null for an unknown email', async () => {
      expect(
        await facade.findCredentialsByEmail('nadie@example.com'),
      ).toBeNull();
    });
  });

  describe('setPasswordHash', () => {
    it('replaces the hash and sets passwordChangedAt to now', async () => {
      const { id } = await facade.createWithPassword({
        email: 'ana@example.com',
        passwordHash: '$argon2id$old',
        displayName: 'Ana',
      });
      clock.current = changedAt;

      await facade.setPasswordHash(id, '$argon2id$new');

      expect(await facade.getAuthState(id)).toEqual({
        userId: id,
        passwordChangedAt: changedAt,
      });
      expect(
        (await facade.findCredentialsByEmail('ana@example.com'))?.passwordHash,
      ).toBe('$argon2id$new');
    });

    it('throws UserNotFound for an unknown user', async () => {
      await expect(
        facade.setPasswordHash('missing', '$argon2id$new'),
      ).rejects.toBeInstanceOf(UserNotFound);
    });
  });

  describe('getAuthState', () => {
    it('returns the registration time as passwordChangedAt for a new user', async () => {
      const { id } = await facade.createWithPassword({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });

      expect(await facade.getAuthState(id)).toEqual({
        userId: id,
        passwordChangedAt: registeredAt,
      });
    });

    it('returns null for an unknown user', async () => {
      expect(await facade.getAuthState('missing')).toBeNull();
    });
  });

  describe('getProfile', () => {
    it('returns the public profile without the hash', async () => {
      const created = await facade.createWithPassword({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });

      const profile = await facade.getProfile(created.id);

      expect(profile).toStrictEqual(created);
      expect(JSON.stringify(profile)).not.toContain('argon2id');
    });

    it('returns null for an unknown user', async () => {
      expect(await facade.getProfile('missing')).toBeNull();
    });
  });

  describe('getDisplayNames', () => {
    async function register(email: string, displayName: string) {
      const { id } = await facade.createWithPassword({
        email,
        passwordHash: '$argon2id$hash',
        displayName,
      });
      return id;
    }

    it('returns the display name of every known id', async () => {
      const ana = await register('ana@example.com', 'Ana');
      const bruno = await register('bruno@example.com', 'Bruno');

      expect(await facade.getDisplayNames([ana, bruno])).toEqual(
        new Map([
          [ana, 'Ana'],
          [bruno, 'Bruno'],
        ]),
      );
    });

    it('leaves unknown ids out of the map', async () => {
      const ana = await register('ana@example.com', 'Ana');

      const names = await facade.getDisplayNames(['missing', ana, 'nope']);

      expect(names.has('missing')).toBe(false);
      expect(names.has('nope')).toBe(false);
      expect([...names]).toEqual([[ana, 'Ana']]);
    });

    it('returns an empty map for an empty list', async () => {
      await register('ana@example.com', 'Ana');

      expect(await facade.getDisplayNames([])).toEqual(new Map());
    });

    it('does not expose any other profile field', async () => {
      const ana = await register('ana@example.com', 'Ana');

      const names = await facade.getDisplayNames([ana]);

      expect([...names.values()]).toEqual(['Ana']);
      expect(JSON.stringify([...names])).not.toContain('example.com');
    });
  });
});
