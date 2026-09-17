import { userProfileSchema } from '@linkvault/shared';
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
      aiConsent: { externalProviders: false },
      outputLanguage: 'es',
      redactName: false,
      createdAt: '2026-09-17T10:00:00.000Z',
    });
    expect(userProfileSchema.parse(profile)).toEqual(profile);
  });

  it('throws UserNotFound for an unknown user', async () => {
    await expect(
      new GetMyProfile(new InMemoryUserRepository()).execute('missing'),
    ).rejects.toBeInstanceOf(UserNotFound);
  });
});
