import {
  apiErrorResponseSchema,
  registerRequestSchema,
  type RegisterRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { configureApp } from '../../app/create-app';
import {
  EmailTaken,
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefresh,
  PasswordPolicyViolation,
  RefreshConflict,
  TooManyAttempts,
} from '../../modules/auth/domain/errors';
import {
  EmailAlreadyRegistered,
  InvalidDisplayName,
  InvalidProfileChanges,
  UserNotFound,
} from '../../modules/users/domain/errors';
import { ZodValidationPipe } from './zod-validation.pipe';

const SECRET_EMAIL = 'ana@example.com';

const THROWN: Record<string, () => unknown> = {
  'invalid-credentials': () => new InvalidCredentials(),
  'email-taken': () => new EmailTaken(),
  'too-many-attempts': () => new TooManyAttempts(12.3),
  'invalid-refresh': () => new InvalidRefresh('reused'),
  'refresh-conflict': () => new RefreshConflict(),
  'invalid-access-token': () => new InvalidAccessToken(),
  'password-policy': () => new PasswordPolicyViolation('newPassword', 'too_short'),
  'email-already-registered': () => new EmailAlreadyRegistered(),
  'invalid-profile-field': () => new InvalidProfileChanges('outputLanguage'),
  'invalid-profile-empty': () => new InvalidProfileChanges(),
  'invalid-display-name': () => new InvalidDisplayName(),
  'user-not-found': () => new UserNotFound('user-123'),
  unknown: () =>
    new Error(`E11000 duplicate key error dup key: { email: "${SECRET_EMAIL}" }`),
  'non-error': () => `leaked ${SECRET_EMAIL}`,
  'not-found': () => new NotFoundException(),
  unavailable: () =>
    new ServiceUnavailableException({ status: 'down', service: 'api' }),
};

@Controller('test-errors')
class ThrowingController {
  @Get(':name')
  throwNamed(@Param('name') name: string): never {
    const make = THROWN[name];
    if (make === undefined) {
      throw new Error(`Unknown test error ${name}`);
    }
    throw make();
  }

  @Post('register')
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
  ): { email: string } {
    return { email: body.email };
  }
}

// Filtro global de errores (D8 de auth-users) sobre una app mínima configurada con el mismo `configureApp` que `createApp`.
describe('ApiExceptionFilter', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
      { logger: false },
    );
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function get(name: string): ReturnType<NestFastifyApplication['inject']> {
    return app.inject({ method: 'GET', url: `/api/test-errors/${name}` });
  }

  it('answers 400 validation_error naming the invalid fields without their values', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-errors/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: 'ana-at-example.com',
        password: 'a-valid-password',
        displayName: '',
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'validation_error',
      message: expect.any(String),
      fields: ['email', 'displayName'],
    });
    expect(response.body).not.toContain('ana-at-example.com');
    expect(response.body).not.toContain('a-valid-password');
  });

  it('passes the parsed body to the handler when it is valid', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-errors/register',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        email: ' Ana@Example.com',
        password: 'a-valid-password',
        displayName: 'Ana',
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ email: 'ana@example.com' });
  });

  it('answers malformed JSON with 400 validation_error and no fields', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-errors/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"email":',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'validation_error',
      message: expect.any(String),
    });
  });

  it('answers an unsupported body type with 415 unsupported_media_type', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/test-errors/register',
      headers: { 'content-type': 'application/xml' },
      payload: '<email>ana@example.com</email>',
    });

    expect(response.statusCode).toBe(415);
    expect(response.json()).toEqual({
      code: 'unsupported_media_type',
      message: expect.any(String),
    });
  });

  it.each([
    ['invalid-credentials', 401, 'invalid_credentials', undefined],
    ['invalid-refresh', 401, 'invalid_refresh', undefined],
    ['invalid-access-token', 401, 'unauthorized', undefined],
    ['user-not-found', 401, 'unauthorized', undefined],
    ['email-taken', 409, 'email_taken', undefined],
    ['email-already-registered', 409, 'email_taken', undefined],
    ['refresh-conflict', 409, 'refresh_conflict', undefined],
    ['password-policy', 400, 'validation_error', ['newPassword']],
    ['invalid-profile-field', 400, 'validation_error', ['outputLanguage']],
    ['invalid-display-name', 400, 'validation_error', ['displayName']],
    ['invalid-profile-empty', 400, 'validation_error', undefined],
  ])(
    'translates %s to %i %s',
    async (name, status, code, fields) => {
      const response = await get(name);

      expect(response.statusCode).toBe(status);
      const body = apiErrorResponseSchema.parse(response.json());
      expect(body).toEqual(
        fields === undefined
          ? { code, message: expect.any(String) }
          : { code, message: expect.any(String), fields },
      );
      expect(response.headers['retry-after']).toBeUndefined();
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it('does not expose the internal reason of a rejected refresh or the user id', async () => {
    const refresh = await get('invalid-refresh');
    const userNotFound = await get('user-not-found');

    expect(refresh.body).not.toContain('reused');
    expect(userNotFound.body).not.toContain('user-123');
  });

  it('translates too_many_attempts to 429 with Retry-After in whole seconds', async () => {
    const response = await get('too-many-attempts');

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'too_many_attempts',
      message: expect.any(String),
    });
    expect(response.headers['retry-after']).toBe('13');
  });

  it.each(['unknown', 'non-error'])(
    'answers a %s failure with 500 internal_error without details or the email in the logs',
    async (name) => {
      const logged = vi.spyOn(Logger.prototype, 'error');

      const response = await get(name);

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        code: 'internal_error',
        message: 'Internal server error',
      });
      expect(response.body).not.toContain(SECRET_EMAIL);
      expect(logged).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET_EMAIL);
    },
  );

  it('logs the name and stack frames of an unknown error', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error');

    await get('unknown');

    const [message, frames] = logged.mock.calls[0] ?? [];
    expect(message).toBe('Unhandled Error');
    expect(frames).toMatch(/^\s+at /);
  });

  it('keeps the Nest response of other HTTP exceptions (unknown route, health 503)', async () => {
    const notFound = await get('not-found');
    const unknownRoute = await app.inject({ method: 'GET', url: '/api/nope' });
    const unavailable = await get('unavailable');

    expect(notFound.statusCode).toBe(404);
    expect(notFound.json()).toEqual({ statusCode: 404, message: 'Not Found' });
    expect(unknownRoute.statusCode).toBe(404);
    expect(unknownRoute.json()).toMatchObject({ statusCode: 404 });
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ status: 'down', service: 'api' });
  });
});
