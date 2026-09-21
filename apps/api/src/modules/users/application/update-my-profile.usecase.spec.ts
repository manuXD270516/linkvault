import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ConsentTextOutdated,
  InvalidDisplayName,
  InvalidProfileChanges,
  UserNotFound,
} from '../domain/errors';
import { createUser, type User } from '../domain/user';
import type { ProfileUpdateInput } from '../domain/user-profile';
import type { Clock } from './ports/clock.port';
import { InMemoryUserRepository } from './testing/in-memory-user.repository';
import { UpdateMyProfile } from './update-my-profile.usecase';

class FixedClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

const registeredAt = new Date('2026-09-17T10:00:00.000Z');
const consentedAt = new Date('2026-09-20T12:00:00.000Z');

describe('UpdateMyProfile', () => {
  let repository: InMemoryUserRepository;
  let clock: FixedClock;
  let user: User;
  let useCase: UpdateMyProfile;

  beforeEach(async () => {
    repository = new InMemoryUserRepository();
    clock = new FixedClock(consentedAt);
    user = await repository.create(
      createUser({
        email: 'ana@example.com',
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
        now: registeredAt,
      }),
    );
    useCase = new UpdateMyProfile(repository, clock);
  });

  it('Activar el consentimiento', async () => {
    const profile = await useCase.execute(user.id, {
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
      },
    });

    expect(profile.aiConsent).toEqual({
      externalProviders: true,
      consentedAt: '2026-09-20T12:00:00.000Z',
      textVersion: AI_CONSENT_TEXT_VERSION,
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    });
    expect(profile.outputLanguage).toBe('es');
    expect(await repository.findById(user.id)).toMatchObject({
      profile: {
        aiConsent: {
          externalProviders: true,
          consentedAt,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      },
    });
  });

  it('Activar sin decir qué texto se aceptó', async () => {
    await expect(
      useCase.execute(user.id, {
        aiConsent: { externalProviders: true },
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'InvalidProfileChanges',
        field: 'textVersion',
      }),
    );
    expect(await repository.findById(user.id)).toEqual(user);
  });

  it('Activar sobre un texto que ya caducó', async () => {
    await expect(
      useCase.execute(user.id, {
        aiConsent: {
          externalProviders: true,
          textVersion: '2026-01-01',
        },
      }),
    ).rejects.toBeInstanceOf(ConsentTextOutdated);
    expect(await repository.findById(user.id)).toEqual(user);
  });

  it('Revocar el consentimiento', async () => {
    await useCase.execute(user.id, {
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
      },
    });

    const profile = await useCase.execute(user.id, {
      aiConsent: { externalProviders: false },
    });

    expect(profile.aiConsent).toEqual({
      externalProviders: false,
      consentedAt: null,
      textVersion: null,
      currentTextVersion: AI_CONSENT_TEXT_VERSION,
    });
  });

  it('Los análisis ya hechos siguen ahí', async () => {
    // El caso de uso solo escribe el perfil: no toca CVs, análisis ni postulaciones.
    await useCase.execute(user.id, {
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
      },
    });
    const before = await repository.findById(user.id);

    await useCase.execute(user.id, {
      aiConsent: { externalProviders: false },
    });

    const after = await repository.findById(user.id);
    expect(after).toEqual({
      ...before,
      profile: {
        ...before!.profile,
        aiConsent: {
          externalProviders: false,
          consentedAt: null,
          textVersion: null,
        },
      },
    });
    expect(Object.keys(after!).sort()).toEqual(Object.keys(before!).sort());
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
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
      outputLanguage: 'en',
      redactName: true,
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
    await useCase.execute(user.id, { redactName: false });
    const profile = await useCase.execute(user.id, {
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
      },
    });

    expect(profile.redactName).toBe(false);
    expect(profile.aiConsent.externalProviders).toBe(true);
  });

  it.each<[string, ProfileUpdateInput, new () => Error]>([
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
      useCase.execute('missing', { redactName: false }),
    ).rejects.toBeInstanceOf(UserNotFound);
  });
});
