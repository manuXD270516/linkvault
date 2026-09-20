import { randomUUID } from 'node:crypto';
import {
  AI_CONSENT_TEXT_VERSION,
  apiErrorResponseSchema,
  userProfileSchema,
  type UserProfile,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../../auth/application/ports/access-token-signer.port';
import { UsersFacade } from '../application/users.facade';
import { USER_MODEL_NAME } from '../infrastructure/user.schema';

// `GET` y `PATCH /api/users/me` (tarea 6.8 de auth-users, spec users/profile) sobre `createApp` con MongoDB del preset.
// El usuario se crea con `UsersFacade` y el access token se firma con el ACCESS_TOKEN_SIGNER de la app: estos tests no
// dependen de `/auth/register`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const PROFILE_FIELDS = [
  'aiConsent',
  'createdAt',
  'displayName',
  'email',
  'id',
  'outputLanguage',
  'redactName',
];

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('UsersController', () => {
  let app: NestFastifyApplication;
  let users: UsersFacade;
  let signer: AccessTokenSigner;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(getMongoTestUri(), `users-http-${randomUUID()}`),
    });
    app = await createApp(config, apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const connection = app.get<Connection>(getConnectionToken());
    await connection.asPromise();
    await connection.model(USER_MODEL_NAME).init();
    users = app.get(UsersFacade, { strict: false });
    signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, { strict: false });
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  /** Usuario nuevo con su access token. */
  async function authenticatedUser(): Promise<{
    profile: UserProfile;
    authorization: string;
  }> {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@Example.com`,
      passwordHash: HASH,
      displayName: 'Ana',
    });
    const { accessToken } = await signer.sign({
      userId: profile.id,
      sessionId: randomUUID(),
    });
    return { profile, authorization: `Bearer ${accessToken}` };
  }

  function getMe(authorization?: string) {
    return app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: authorization ? { authorization } : {},
    });
  }

  function patchMe(authorization: string | undefined, body: unknown) {
    return app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      payload: JSON.stringify(body),
    });
  }

  describe('GET /api/users/me', () => {
    it('Consulta correcta', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await getMe(authorization);

      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(PROFILE_FIELDS);
      expect(userProfileSchema.parse(body)).toEqual({
        id: profile.id,
        email: profile.email,
        displayName: 'Ana',
        aiConsent: {
          externalProviders: false,
          consentedAt: null,
          textVersion: null,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
        outputLanguage: 'es',
        redactName: true,
        createdAt: profile.createdAt,
      });
      expect(response.body).not.toContain('argon2id');
      expect(response.body).not.toContain('passwordChangedAt');
    });

    it('Consentimiento aceptado sobre un texto anterior', async () => {
      const { profile, authorization } = await authenticatedUser();
      const connection = app.get<Connection>(getConnectionToken());
      await connection.model(USER_MODEL_NAME).updateOne(
        { _id: profile.id },
        {
          $set: {
            'aiConsent.externalProviders': true,
            'aiConsent.consentedAt': new Date('2026-09-01T00:00:00.000Z'),
            'aiConsent.textVersion': '2026-01-01',
          },
        },
      );

      const response = await getMe(authorization);

      expect(response.statusCode).toBe(200);
      expect(userProfileSchema.parse(response.json()).aiConsent).toEqual({
        externalProviders: true,
        consentedAt: '2026-09-01T00:00:00.000Z',
        textVersion: '2026-01-01',
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      });
    });

    it('answers 401 unauthorized without a token', async () => {
      const response = await getMe();

      expect(response.statusCode).toBe(401);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'unauthorized',
      });
    });
  });

  describe('PATCH /api/users/me', () => {
    it('Activar el consentimiento', async () => {
      const { authorization } = await authenticatedUser();

      const response = await patchMe(authorization, {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = userProfileSchema.parse(response.json());
      expect(body.aiConsent.externalProviders).toBe(true);
      expect(body.aiConsent.textVersion).toBe(AI_CONSENT_TEXT_VERSION);
      expect(body.aiConsent.consentedAt).toEqual(expect.any(String));
      expect(body.outputLanguage).toBe('es');
      expect(
        userProfileSchema.parse((await getMe(authorization)).json()),
      ).toEqual(body);
    });

    it('Activar sin decir qué texto se aceptó', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await patchMe(authorization, {
        aiConsent: { externalProviders: true },
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'validation_error',
        fields: ['aiConsent.textVersion'],
      });
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('Activar sobre un texto que ya caducó', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await patchMe(authorization, {
        aiConsent: {
          externalProviders: true,
          textVersion: '2026-01-01',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'consent_text_outdated',
      });
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('Revocar el consentimiento', async () => {
      const { authorization } = await authenticatedUser();
      await patchMe(authorization, {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
        },
      });

      const response = await patchMe(authorization, {
        aiConsent: { externalProviders: false },
      });

      expect(response.statusCode).toBe(200);
      const body = userProfileSchema.parse(response.json());
      expect(body.aiConsent).toEqual({
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      });
    });

    it('rejects consentedAt or currentTextVersion in the body', async () => {
      const { profile, authorization } = await authenticatedUser();

      const withDate = await patchMe(authorization, {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
          consentedAt: '2026-09-20T12:00:00.000Z',
        },
      });
      const withCurrent = await patchMe(authorization, {
        aiConsent: {
          externalProviders: true,
          textVersion: AI_CONSENT_TEXT_VERSION,
          currentTextVersion: AI_CONSENT_TEXT_VERSION,
        },
      });

      expect(withDate.statusCode).toBe(400);
      expect(withCurrent.statusCode).toBe(400);
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('applies only the sent fields and trims displayName', async () => {
      const { profile, authorization } = await authenticatedUser();
      await patchMe(authorization, { redactName: false });

      const response = await patchMe(authorization, {
        displayName: '  Ana María ',
        outputLanguage: 'en',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        ...profile,
        displayName: 'Ana María',
        outputLanguage: 'en',
        redactName: false,
      });
    });

    it('Campo no editable', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await patchMe(authorization, {
        email: 'otro@example.com',
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'validation_error',
        fields: ['email'],
      });
      expect(response.body).not.toContain('otro@example.com');
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('rejects password and an unknown field next to a valid one without changing the profile', async () => {
      const { profile, authorization } = await authenticatedUser();

      const withPassword = await patchMe(authorization, {
        password: 'new-password-123',
      });
      const mixed = await patchMe(authorization, {
        displayName: 'Otra',
        role: 'admin',
      });

      expect(withPassword.statusCode).toBe(400);
      expect(mixed.statusCode).toBe(400);
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('Idioma no soportado', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await patchMe(authorization, { outputLanguage: 'fr' });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'validation_error',
        fields: ['outputLanguage'],
      });
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('rejects an empty body without changing the profile', async () => {
      const { profile, authorization } = await authenticatedUser();

      const response = await patchMe(authorization, {});

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'validation_error' });
      expect((await getMe(authorization)).json()).toEqual(profile);
    });

    it('answers 401 unauthorized without a token', async () => {
      const response = await patchMe(undefined, { redactName: false });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ code: 'unauthorized' });
    });
  });
});
