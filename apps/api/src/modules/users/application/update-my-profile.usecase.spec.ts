import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidDisplayName,
  InvalidProfileChanges,
  UserNotFound,
} from '../domain/errors';
import { createUser, type User } from '../domain/user';
import type { ProfileChanges } from '../domain/user-profile';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';
import { UpdateMyProfile } from './update-my-profile.usecase';

describe('UpdateMyProfile', () => {
  let repository: InMemoryUserRepository;
  let user: User;
  let useCase: UpdateMyProfile;

  beforeEach(async () => {
    repository = new InMemoryUserRepository();
    user = await repository.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
        now: new Date('2026-09-17T10:00:00.000Z'),
      }),
    );
    useCase = new UpdateMyProfile(repository);
  });

  it('Activar el consentimiento', async () => {
    const profile = await useCase.execute(user.id, {
      aiConsent: { externalProviders: true },
    });

    expect(profile.aiConsent).toEqual({
      externalProviders: true,
      consentedAt: null,
      textVersion: null,
      currentTextVersion: '2026-09-20',
    });
    expect(profile.outputLanguage).toBe('es');
  });

  it('changes only the sent fields and returns the full profile', async () => {
    const profile = await useCase.execute(user.id, {
      outputLanguage: 'en',
      displayName: '  Ana María ',
    });

    expect(profile).toStrictEqual({
      id: user.id,
      email: 'ana@example.com',
      displayName: 'Ana María',
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: '2026-09-20',
      },
      outputLanguage: 'en',
      redactName: false,
      createdAt: '2026-09-17T10:00:00.000Z',
    });
    expect(await repository.findById(user.id)).toEqual({
      ...user,
      profile: {
        ...user.profile,
        displayName: 'Ana María',
        outputLanguage: 'en',
      },
    });
  });

  it('keeps previous changes when a later update sends other fields', async () => {
    await useCase.execute(user.id, { redactName: true });
    const profile = await useCase.execute(user.id, {
      aiConsent: { externalProviders: true },
    });

    expect(profile.redactName).toBe(true);
    expect(profile.aiConsent.externalProviders).toBe(true);
  });

  it.each<[string, ProfileChanges, new () => Error]>([
    ['empty changes', {}, InvalidProfileChanges],
    ['a blank display name', { displayName: '   ' }, InvalidDisplayName],
  ])('rejects %s without modifying the profile', async (_, changes, error) => {
    await expect(useCase.execute(user.id, changes)).rejects.toBeInstanceOf(
      error,
    );
    expect(await repository.findById(user.id)).toEqual(user);
  });

  it('throws UserNotFound for an unknown user', async () => {
    await expect(
      useCase.execute('missing', { redactName: true }),
    ).rejects.toBeInstanceOf(UserNotFound);
  });
});
