import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  extensionSessionResponseSchema,
  saveLinkResponseSchema,
  sessionResponseSchema,
} from '@linkvault/shared';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CapturingMailer } from '../../../infrastructure/mail/capturing-mailer';
import { MAILER } from '../../../infrastructure/mail/mailer.port';
import {
  authPost,
  createAuthTestApp,
  refreshSetCookie,
  refreshTokenFrom,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';
import { AUTH_SESSIONS_COLLECTION } from '../infrastructure/session.schemas';

// Extension auth HTTP (ADR-038 / tasks 2.1–2.4): login/refresh/logout sin cookie, rechazo cruzado,
// rate-limit compartido, revoke-all, Bearer → POST /api/links.

const PASSWORD = 'correct-horse-battery';

describe('ExtensionAuthController', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  async function registerWeb(email: string) {
    const response = await authPost(harness.app, 'register', {
      body: { email, password: PASSWORD, displayName: 'Ana' },
      remoteAddress: `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    });
    expect(response.statusCode).toBe(201);
    return {
      body: sessionResponseSchema.parse(response.json()),
      refreshToken: refreshTokenFrom(response.headers),
    };
  }

  function extensionLogin(
    email: string,
    password = PASSWORD,
    options: { csrf?: boolean; remoteAddress?: string } = {},
  ) {
    return authPost(harness.app, 'extension/login', {
      body: { email, password },
      csrf: options.csrf,
      remoteAddress: options.remoteAddress ?? '203.0.113.50',
    });
  }

  function extensionRefresh(refreshToken: string, csrf = true) {
    return authPost(harness.app, 'extension/refresh', {
      body: { refreshToken },
      csrf,
    });
  }

  function extensionLogout(refreshToken: string) {
    return authPost(harness.app, 'extension/logout', {
      body: { refreshToken },
    });
  }

  function expectNoRefreshCookie(
    headers: Parameters<typeof refreshSetCookie>[0],
  ): void {
    expect(refreshSetCookie(headers)).toBeUndefined();
  }

  it('Login exitoso sin cookie', async () => {
    const email = `ext-login-${randomUUID()}@example.com`;
    await registerWeb(email);

    const response = await extensionLogin(email);

    expect(response.statusCode).toBe(200);
    const body = extensionSessionResponseSchema.parse(response.json());
    expect(body.accessToken).not.toBe('');
    expect(body.refreshToken).not.toBe('');
    expect(body.user.email).toBe(email);
    expectNoRefreshCookie(response.headers);

    const stored = await harness.connection
      .collection(AUTH_SESSIONS_COLLECTION)
      .findOne({ userId: body.user.id, client: 'extension' });
    expect(stored).not.toBeNull();
  });

  it('Credenciales inválidas', async () => {
    const email = `ext-bad-${randomUUID()}@example.com`;
    await registerWeb(email);

    const response = await extensionLogin(email, 'wrong-password-xx');

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'invalid_credentials',
      message: expect.any(String),
    });
    expect(response.json()).not.toHaveProperty('refreshToken');
    expect(response.json()).not.toHaveProperty('accessToken');
    expectNoRefreshCookie(response.headers);
  });

  it('Sin cabecera CSRF', async () => {
    const response = await extensionLogin(
      `ext-csrf-${randomUUID()}@example.com`,
      PASSWORD,
      { csrf: false },
    );

    expect(response.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'csrf_header_missing',
    });
  });

  it('Extension login comparte límite por email', async () => {
    const email = `ext-limit-${randomUUID()}@example.com`;
    await registerWeb(email);
    for (let i = 0; i < 5; i++) {
      const failed = await authPost(harness.app, 'login', {
        body: { email, password: 'wrong-password-xx' },
        remoteAddress: '198.51.100.200',
      });
      expect(failed.statusCode).toBe(401);
    }

    const response = await extensionLogin(email, PASSWORD, {
      remoteAddress: '198.51.100.201',
    });

    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'too_many_attempts',
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('Rotación por cuerpo', async () => {
    const email = `ext-rot-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const r1 = extensionSessionResponseSchema.parse(login.json()).refreshToken;

    const response = await extensionRefresh(r1);

    expect(response.statusCode).toBe(200);
    const body = extensionSessionResponseSchema.parse(response.json());
    expect(body.refreshToken).not.toBe(r1);
    expectNoRefreshCookie(response.headers);

    // Una vez usado R2, R1 deja de aceptar un refresh: 409 dentro de la ventana y reuso después.
    const used = await extensionRefresh(body.refreshToken);
    expect(used.statusCode).toBe(200);
    harness.clock.advance(2_000);
    const conflict = await extensionRefresh(r1);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'refresh_conflict' });
    expectNoRefreshCookie(conflict.headers);

    harness.clock.advance(11_000);
    const reuse = await extensionRefresh(r1);
    expect(reuse.statusCode).toBe(401);
    expect(reuse.json()).toMatchObject({ code: 'invalid_refresh' });
    expectNoRefreshCookie(reuse.headers);
  });

  it('Respuesta perdida en la extensión', async () => {
    const email = `ext-lost-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const r1 = extensionSessionResponseSchema.parse(login.json()).refreshToken;
    // La respuesta de esta rotación se pierde (service worker suspendido): R2 se descarta.
    const lost = await extensionRefresh(r1);
    expect(lost.statusCode).toBe(200);
    const r2 = extensionSessionResponseSchema.parse(lost.json()).refreshToken;
    harness.clock.advance(2_000);

    const recovered = await extensionRefresh(r1);

    expect(recovered.statusCode).toBe(200);
    const r3 = extensionSessionResponseSchema.parse(
      recovered.json(),
    ).refreshToken;
    expect(r3).not.toBe(r1);
    expect(r3).not.toBe(r2);
    expectNoRefreshCookie(recovered.headers);
    // La sesión no quedó revocada: R3 rota.
    const next = await extensionRefresh(r3);
    expect(next.statusCode).toBe(200);
    expectNoRefreshCookie(next.headers);
  });

  it('Refresh de sesión web rechazado', async () => {
    const email = `ext-web-${randomUUID()}@example.com`;
    const web = await registerWeb(email);
    const webRefresh = web.refreshToken;
    expect(webRefresh).toBeDefined();

    const response = await extensionRefresh(webRefresh ?? '');

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'invalid_refresh',
    });
    expectNoRefreshCookie(response.headers);
  });

  it('Refresh extensión rechazado en path cookie', async () => {
    const email = `ext-cookie-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const refreshToken = extensionSessionResponseSchema.parse(
      login.json(),
    ).refreshToken;

    const response = await authPost(harness.app, 'refresh', { refreshToken });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_refresh' });
    // Web path clears cookie on invalid_refresh; that is fine. Must not emit a successor cookie value.
    const cookie = refreshSetCookie(response.headers) ?? '';
    expect(cookie).toMatch(/^lv_refresh=;/);
  });

  it('Error de refresh no toca cookie SPA', async () => {
    const response = await extensionRefresh('not-a-real-token');

    expect(response.statusCode).toBe(401);
    expectNoRefreshCookie(response.headers);
  });

  it('409 refresh_conflict no emite Set-Cookie', async () => {
    const email = `ext-409-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const r1 = extensionSessionResponseSchema.parse(login.json()).refreshToken;

    // Tres refresh a la vez con el mismo token: los tres reciben un hermano y ninguno lleva cookie.
    const responses = await Promise.all([
      extensionRefresh(r1),
      extensionRefresh(r1),
      extensionRefresh(r1),
    ]);
    expect(responses.map((r) => r.statusCode)).toEqual([200, 200, 200]);
    for (const response of responses) {
      expectNoRefreshCookie(response.headers);
    }

    // Usado uno de ellos, otro hermano da 409 sin cookie.
    harness.clock.advance(1_000);
    const [used, other] = responses.map(
      (r) => extensionSessionResponseSchema.parse(r.json()).refreshToken,
    );
    expect((await extensionRefresh(used ?? '')).statusCode).toBe(200);
    const conflict = await extensionRefresh(other ?? '');
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: 'refresh_conflict' });
    expectNoRefreshCookie(conflict.headers);
  });

  it('Tras change-password revoca refresh extensión', async () => {
    const email = `ext-chpw-${randomUUID()}@example.com`;
    const web = await registerWeb(email);
    const login = await extensionLogin(email);
    const refreshToken = extensionSessionResponseSchema.parse(
      login.json(),
    ).refreshToken;

    const changed = await authPost(harness.app, 'password', {
      body: {
        currentPassword: PASSWORD,
        newPassword: 'new-correct-horse-battery',
      },
      accessToken: web.body.accessToken,
    });
    expect(changed.statusCode).toBe(204);

    const response = await extensionRefresh(refreshToken);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_refresh' });
    expectNoRefreshCookie(response.headers);
  });

  it('Logout revoca', async () => {
    const email = `ext-out-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const refreshToken = extensionSessionResponseSchema.parse(
      login.json(),
    ).refreshToken;

    const response = await extensionLogout(refreshToken);

    expect(response.statusCode).toBe(204);
    expectNoRefreshCookie(response.headers);

    const after = await extensionRefresh(refreshToken);
    expect(after.statusCode).toBe(401);
    expect(after.json()).toMatchObject({ code: 'invalid_refresh' });
    expectNoRefreshCookie(after.headers);

    const idempotent = await extensionLogout(refreshToken);
    expect(idempotent.statusCode).toBe(204);
    expectNoRefreshCookie(idempotent.headers);
  });

  it('Tras reset de password', async () => {
    const email = `ext-reset-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const refreshToken = extensionSessionResponseSchema.parse(
      login.json(),
    ).refreshToken;

    const mailer = harness.app.get<CapturingMailer>(MAILER, { strict: false });
    mailer.clear();
    const forgot = await authPost(harness.app, 'forgot-password', {
      body: { email },
    });
    expect(forgot.statusCode).toBe(200);
    const message = mailer.lastTo(email);
    expect(message?.templateId).toBe('password-reset');
    if (message === undefined) {
      throw new Error('expected password-reset mail');
    }
    const token = new URL(message.variables.actionUrl).searchParams.get(
      'token',
    );
    expect(token).toBeTruthy();

    const reset = await authPost(harness.app, 'reset-password', {
      body: { token: token ?? '', newPassword: 'new-correct-horse' },
    });
    expect(reset.statusCode).toBe(204);

    const response = await extensionRefresh(refreshToken);
    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ code: 'invalid_refresh' });
    expectNoRefreshCookie(response.headers);
  });

  it('Guardar link con token de extensión', async () => {
    const email = `ext-link-${randomUUID()}@example.com`;
    await registerWeb(email);
    const login = await extensionLogin(email);
    const accessToken = extensionSessionResponseSchema.parse(
      login.json(),
    ).accessToken;

    const response = await harness.app.inject({
      method: 'POST',
      url: '/api/links',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      payload: JSON.stringify({
        url: 'https://www.linkedin.com/jobs/view/3811111999/',
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(saveLinkResponseSchema.parse(response.json()).created).toBe(true);
  });
});
