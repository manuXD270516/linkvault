import { AI_CONSENT_TEXT_VERSION, userProfileSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { UserNotFound } from '../domain/errors';
import { createUser } from '../domain/user';
import { GetMyProfile } from './get-my-profile.usecase';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';

const createdAt = new Date('2026-09-17T10:00:00.000Z');

describe('GetMyProfile', () => {
  it('returns exactly the public profile fields with createdAt as ISO', async () => {
    const repository = new InMemoryUserRepository();
    const user = await repository.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
        now: createdAt,
      }),
    );

    const profile = await new GetMyProfile(repository).execute(user.id);

    expect(profile).toStrictEqual({
      id: user.id,
      email: 'ana@example.com',
      displayName: 'Ana',
      emailVerified: false,
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
      outputLanguage: 'es',
      redactName: true,
      createdAt: '2026-09-17T10:00:00.000Z',
    });
    expect(userProfileSchema.parse(profile)).toEqual(profile);
  });

  it('Consentimiento aceptado sobre un texto anterior', async () => {
    const repository = new InMemoryUserRepository();
    const user = await repository.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
        now: createdAt,
      }),
    );
    await repository.updateProfile(user.id, {
      aiConsent: {
        externalProviders: true,
        consentedAt: new Date('2026-09-01T00:00:00.000Z'),
        textVersion: '2026-01-01',
      },
    });

    const profile = await new GetMyProfile(repository).execute(user.id);

    expect(profile.aiConsent).toEqual({
      externalProviders: true,
      consentedAt: '2026-09-01T00:00:00.000Z',
      textVersion: '2026-01-01',
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    });
  });

  it('throws UserNotFound for an unknown user', async () => {
    await expect(
      new GetMyProfile(new InMemoryUserRepository()).execute('missing'),
    ).rejects.toBeInstanceOf(UserNotFound);
  });
});
