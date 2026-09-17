import { randomUUID } from 'node:crypto';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { Controller, Get } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { configureApp } from '../../../app/create-app';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import { apiTestConfig } from '../../../test-support/test-config';
import { UsersFacade } from '../../users/application/users.facade';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../application/ports/access-token-signer.port';
import { JoseAccessTokenSigner } from '../infrastructure/jose-access-token-signer';

// Guard global de access token (tarea 6.3 de auth-users) sobre el `AppModule` real y `configureApp`, con MongoDB del
// preset. `UsersController` llega en 6.8: la ruta protegida de test hace de `GET /api/users/me` en los escenarios.

@Controller('test-guard')
class GuardProbeController {
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Public()
  @Get('public-me')
  publicMe(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }
}

const PROTECTED_URL = '/api/test-guard/me';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('access token guard over the api app', () => {
  let app: NestFastifyApplication;
  let users: UsersFacade;
  let signer: AccessTokenSigner;
  let config: Awaited<ReturnType<typeof apiTestConfig>>;

  beforeAll(async () => {
    config = await apiTestConfig({
      MONGO_URI: withDatabase(getMongoTestUri(), `auth-guard-${randomUUID()}`),
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register(config)],
      controllers: [GuardProbeController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get<Connection>(getConnectionToken()).asPromise();
    users = app.get(UsersFacade, { strict: false });
    signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, { strict: false });
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  async function registerUser(): Promise<string> {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash: HASH,
      displayName: 'Ana',
    });
    return profile.id;
  }

  /** Firma con el secreto de la app y un reloj fijo en `at`. */
  async function tokenIssuedAt(
    userId: string,
    sessionId: string,
    at: Date,
  ): Promise<string> {
    const signerAt = new JoseAccessTokenSigner(
      {
        secret: config.AUTH_JWT_SECRET,
        ttlSeconds: config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
      },
      { now: () => at },
    );
    return (await signerAt.sign({ userId, sessionId })).accessToken;
  }

  function getProtected(token?: string) {
    return app.inject({
      method: 'GET',
      url: PROTECTED_URL,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
    });
  }

  async function expectUnauthorized(
    response: Awaited<ReturnType<typeof getProtected>>,
  ): Promise<void> {
    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'unauthorized',
      message: expect.any(String),
    });
  }

  it('Perfil sin token', async () => {
    await expectUnauthorized(await getProtected());
  });

  it('answers a valid token with the user and session of the token', async () => {
    const userId = await registerUser();
    const { accessToken } = await signer.sign({ userId, sessionId: 'session-a' });

    const response = await getProtected(accessToken);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId, sessionId: 'session-a' });
  });

  it('Token caducado', async () => {
    const userId = await registerUser();
    const issuedAt = new Date(
      Date.now() - (config.AUTH_ACCESS_TOKEN_TTL_SECONDS + 60) * 1000,
    );

    await expectUnauthorized(
      await getProtected(await tokenIssuedAt(userId, 'session-a', issuedAt)),
    );
  });

  it('rejects a badly signed token', async () => {
    const userId = await registerUser();
    const other = new JoseAccessTokenSigner(
      { secret: 'another-test-jwt-secret-of-32-chars!!', ttlSeconds: 900 },
      { now: () => new Date() },
    );
    const { accessToken } = await other.sign({ userId, sessionId: 'session-a' });

    await expectUnauthorized(await getProtected(accessToken));
  });

  it('rejects a token of a user that does not exist', async () => {
    const { accessToken } = await signer.sign({
      userId: '66e9a0000000000000000404',
      sessionId: 'session-a',
    });

    await expectUnauthorized(await getProtected(accessToken));
  });

  it('Token anterior al cambio de contraseña', async () => {
    const userId = await registerUser();
    const tokenB = await tokenIssuedAt(userId, 'session-b', new Date());
    expect((await getProtected(tokenB)).statusCode).toBe(200);

    // `iat` tiene precisión de segundos: el cambio debe caer en un segundo posterior a la emisión de B.
    await new Promise((resolve) =>
      setTimeout(resolve, 1_000 - (Date.now() % 1_000) + 20),
    );
    // Cambio de contraseña desde la sesión A.
    await users.setPasswordHash(userId, '$argon2id$new-hash');
    const state = await users.getAuthState(userId);
    const tokenA = await tokenIssuedAt(
      userId,
      'session-a',
      new Date((state?.passwordChangedAt.getTime() ?? 0) + 1_000),
    );

    await expectUnauthorized(await getProtected(tokenB));
    expect((await getProtected(tokenA)).statusCode).toBe(200);
  });

  it('Salud pública', async () => {
    const readiness = await app.inject({ method: 'GET', url: '/health' });
    const liveness = await app.inject({ method: 'GET', url: '/health/live' });

    expect(readiness.statusCode).not.toBe(401);
    expect(liveness.statusCode).toBe(200);
  });

  it('keeps unknown /api routes as 404 (the guard only runs on matched routes)', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });

    expect(response.statusCode).toBe(404);
  });

  it('fails with 500 when @CurrentUser() is used on a public route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/test-guard/public-me',
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ code: 'internal_error' });
  });
});
