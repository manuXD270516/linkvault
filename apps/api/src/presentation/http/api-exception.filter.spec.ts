import {
  apiErrorResponseSchema,
  PASTED_TEXT_MAX_LENGTH,
  pastedDescriptionRequestSchema,
  registerRequestSchema,
  type PastedDescriptionRequest,
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
  AlreadyOwner,
  GroupFull,
  GroupNotFound,
  InvalidGroupName,
  InvalidInviteCode,
  MemberNotFound,
  OwnerCannotLeave,
  OwnerRoleRequired,
  TooManyGroups,
  TooManyJoinAttempts,
} from '../../modules/groups/domain/errors';
import {
  ApplicationConflict,
  ApplicationNotFound,
  InvalidAppliedAt,
  InvalidNotes,
  InvalidStageLabel,
  TrackedLinkNotFound,
  TrackersGroupNotFound,
} from '../../modules/applications/domain/errors';
import {
  CommentDeletionForbidden,
  CommentNotFound,
  CommentsGroupNotFound,
  EnrichmentNotRetryable,
  InvalidCommentText,
  InvalidCursor,
  InvalidShareNote,
  NoteRemovalForbidden,
  PublicShareForbidden,
  PublicShareNotFound,
  InvalidUrl,
  LinkNotFound,
  LinkRemovalForbidden,
  PreviewFieldUnknown,
  TextTooLong,
  TooManyLinkAttempts,
  NotAJobPosting,
  ExtractionUnavailable,
  AiQuotaExceeded,
} from '../../modules/links/domain/errors';
import {
  CvFileTooLarge,
  CvNotFound,
  InvalidCvUpload,
  TooManyCvAttempts,
  TooManyCvDocuments,
  UnsupportedCvFile,
} from '../../modules/cv/domain/errors';
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
  'password-policy': () =>
    new PasswordPolicyViolation('newPassword', 'too_short'),
  'email-already-registered': () => new EmailAlreadyRegistered(),
  'invalid-profile-field': () => new InvalidProfileChanges('outputLanguage'),
  'invalid-profile-empty': () => new InvalidProfileChanges(),
  'invalid-display-name': () => new InvalidDisplayName(),
  'user-not-found': () => new UserNotFound('user-123'),
  'group-not-found': () => new GroupNotFound(),
  'member-not-found': () => new MemberNotFound(),
  'owner-role-required': () => new OwnerRoleRequired(),
  'invalid-invite-code': () => new InvalidInviteCode(),
  'group-full': () => new GroupFull(),
  'too-many-groups': () => new TooManyGroups(),
  'owner-cannot-leave': () => new OwnerCannotLeave(),
  'already-owner': () => new AlreadyOwner(),
  'too-many-join-attempts': () => new TooManyJoinAttempts(899.4),
  'invalid-group-name': () => new InvalidGroupName(),
  'invalid-url': () => new InvalidUrl(),
  'text-too-long': () => new TextTooLong(),
  'link-not-found': () => new LinkNotFound(),
  'link-removal-forbidden': () => new LinkRemovalForbidden(),
  'invalid-cursor': () => new InvalidCursor(),
  'preview-field-unknown': () => new PreviewFieldUnknown('image'),
  'enrichment-not-retryable': () => new EnrichmentNotRetryable(),
  'too-many-link-attempts': () => new TooManyLinkAttempts(41.2),
  'not-a-job-posting': () => new NotAJobPosting(),
  'extraction-unavailable': () => new ExtractionUnavailable(60),
  'ai-quota-exceeded': () => new AiQuotaExceeded(86_400),
  'invalid-comment-text': () => new InvalidCommentText(),
  'invalid-share-note': () => new InvalidShareNote(),
  'comment-not-found': () => new CommentNotFound(),
  'comment-deletion-forbidden': () => new CommentDeletionForbidden(),
  'note-removal-forbidden': () => new NoteRemovalForbidden(),
  'comments-group-not-found': () => new CommentsGroupNotFound(),
  'public-share-forbidden': () => new PublicShareForbidden(),
  'public-share-not-found': () => new PublicShareNotFound(),
  'application-not-found': () => new ApplicationNotFound(),
  'application-conflict': () => new ApplicationConflict(),
  'tracked-link-not-found': () => new TrackedLinkNotFound(),
  'trackers-group-not-found': () => new TrackersGroupNotFound(),
  'invalid-applied-at': () => new InvalidAppliedAt(),
  'invalid-stage-label': () => new InvalidStageLabel(),
  'invalid-notes': () => new InvalidNotes(),
  'cv-not-found': () => new CvNotFound(),
  'unsupported-cv-file': () => new UnsupportedCvFile(),
  'cv-file-too-large': () => new CvFileTooLarge(),
  'too-many-cvs': () => new TooManyCvDocuments(),
  'invalid-cv-upload': () => new InvalidCvUpload(),
  'too-many-cv-attempts': () => new TooManyCvAttempts(742),
  unknown: () =>
    new Error(
      `E11000 duplicate key error dup key: { email: "${SECRET_EMAIL}" }`,
    ),
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

  @Post('pasted')
  paste(
    @Body(new ZodValidationPipe(pastedDescriptionRequestSchema))
    body: PastedDescriptionRequest,
  ): { length: number } {
    return { length: body.text.length };
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

  describe('Lo pegado tiene que parecer una oferta', () => {
    function paste(
      payload: unknown,
    ): ReturnType<NestFastifyApplication['inject']> {
      return app.inject({
        method: 'POST',
        url: '/api/test-errors/pasted',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify(payload),
      });
    }

    it('Texto vacío', async () => {
      const response = await paste({ text: '   \n\t  ' });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toEqual({
        code: 'validation_error',
        message: expect.any(String),
        fields: ['text'],
      });
    });

    it('answers a text over twenty thousand characters with 400 text_too_long, without echoing it', async () => {
      const text = `MARCA-${'a'.repeat(PASTED_TEXT_MAX_LENGTH)}`;

      const response = await paste({ text });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toEqual({
        code: 'text_too_long',
        message: expect.any(String),
      });
      expect(response.body).not.toContain('MARCA-');
    });

    it('takes twenty thousand characters, measured without the outer spaces', async () => {
      const response = await paste({
        text: `  ${'a'.repeat(PASTED_TEXT_MAX_LENGTH)}  `,
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ length: PASTED_TEXT_MAX_LENGTH });
    });

    it('keeps validation_error when something else is wrong besides the length', async () => {
      const response = await paste({
        text: 'a'.repeat(PASTED_TEXT_MAX_LENGTH + 1),
        salary: 3000,
      });

      expect(response.statusCode).toBe(400);
      const body = apiErrorResponseSchema.parse(response.json());
      expect(body.code).toBe('validation_error');
      expect([...(body.fields ?? [])].sort()).toEqual(['salary', 'text']);
    });
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
    ['group-not-found', 404, 'group_not_found', undefined],
    ['member-not-found', 404, 'member_not_found', undefined],
    ['owner-role-required', 403, 'forbidden', undefined],
    ['invalid-invite-code', 404, 'invalid_invite_code', undefined],
    ['group-full', 409, 'group_full', undefined],
    ['too-many-groups', 409, 'too_many_groups', undefined],
    ['owner-cannot-leave', 409, 'owner_cannot_leave', undefined],
    ['already-owner', 409, 'already_owner', undefined],
    ['invalid-group-name', 400, 'validation_error', ['name']],
    // Errores de `links`: `invalid_url` y `text_too_long` no nombran campo, el código ya dice cuál es.
    ['invalid-url', 400, 'invalid_url', undefined],
    ['text-too-long', 400, 'text_too_long', undefined],
    ['link-not-found', 404, 'link_not_found', undefined],
    ['link-removal-forbidden', 403, 'forbidden', undefined],
    ['invalid-cursor', 400, 'validation_error', ['cursor']],
    // El campo desconocido sí se nombra: sin decir cuál, quien lo envió tendría que adivinarlo.
    ['preview-field-unknown', 400, 'preview_field_unknown', ['image']],
    ['enrichment-not-retryable', 409, 'enrichment_not_retryable', undefined],
    // Comentarios y nota de group-comments: los de campo nombran su campo (rama `InvalidLinkField`).
    ['invalid-comment-text', 400, 'validation_error', ['text']],
    ['invalid-share-note', 400, 'validation_error', ['note']],
    ['comment-not-found', 404, 'comment_not_found', undefined],
    ['comment-deletion-forbidden', 403, 'forbidden', undefined],
    ['note-removal-forbidden', 403, 'forbidden', undefined],
    ['comments-group-not-found', 404, 'group_not_found', undefined],
    // Enlace público: sin código nuevo, los de siempre (D10 de public-preview-share).
    ['public-share-forbidden', 403, 'forbidden', undefined],
    ['public-share-not-found', 404, 'link_not_found', undefined],
    // Errores de `applications`: la fecha futura nombra `appliedAt` (tiene su rama antes de la genérica).
    ['invalid-applied-at', 400, 'validation_error', ['appliedAt']],
    ['invalid-stage-label', 400, 'validation_error', ['stageLabel']],
    ['invalid-notes', 400, 'validation_error', ['notes']],
    ['application-not-found', 404, 'application_not_found', undefined],
    ['application-conflict', 409, 'application_conflict', undefined],
    ['tracked-link-not-found', 404, 'link_not_found', undefined],
    ['trackers-group-not-found', 404, 'group_not_found', undefined],
  ])('translates %s to %i %s', async (name, status, code, fields) => {
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
  });

  it('gives the same body to a missing group, an unknown invite code and their variants', async () => {
    const notFound = await get('group-not-found');
    const invalidCode = await get('invalid-invite-code');

    // Los dos son 404, pero con código distinto: el SPA explica cada uno a su manera.
    expect(notFound.statusCode).toBe(invalidCode.statusCode);
    expect(notFound.json()).toMatchObject({ code: 'group_not_found' });
    expect(invalidCode.json()).toMatchObject({ code: 'invalid_invite_code' });
    // Ninguno lleva identificadores ni códigos de invitación.
    expect(notFound.body).not.toMatch(/[0-9a-f]{24}/);
    expect(invalidCode.body).not.toMatch(/[0-9A-Z]{8}/);
  });

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

  it('translates the retry limit of a link to 429 with its own Retry-After', async () => {
    const response = await get('too-many-link-attempts');

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'too_many_attempts',
      message: expect.any(String),
    });
    // Se redondea hacia arriba como el de `auth`: 41,2 s de espera no se anuncian como 41.
    expect(response.headers['retry-after']).toBe('42');
  });

  it('translates the join limit to 429 with its Retry-After, although it is a GroupsError', async () => {
    const response = await get('too-many-join-attempts');

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'too_many_attempts',
      message: expect.any(String),
    });
    // Sin su rama propia, la de `GroupsError` respondería el mismo código sin la cabecera.
    expect(response.headers['retry-after']).toBe('900');
  });

  it('answers a paste that is not a job posting with 422 not_a_job_posting', async () => {
    const response = await get('not-a-job-posting');

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      code: 'not_a_job_posting',
      message: expect.any(String),
    });
  });

  it.each([
    ['extraction-unavailable', 503, 'extraction_unavailable', '60'],
    ['ai-quota-exceeded', 429, 'ai_quota_exceeded', '86400'],
  ])(
    'answers %s with %i %s and its Retry-After',
    async (name, status, code, retryAfter) => {
      const response = await get(name);

      expect(response.statusCode).toBe(status);
      expect(response.json()).toEqual({ code, message: expect.any(String) });
      expect(response.headers['retry-after']).toBe(retryAfter);
    },
  );

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

  it.each([
    ['cv-not-found', 404, 'cv_not_found'],
    ['unsupported-cv-file', 415, 'unsupported_file_type'],
    ['cv-file-too-large', 413, 'file_too_large'],
    ['too-many-cvs', 409, 'too_many_cvs'],
  ] as const)('answers %s with %i %s', async (name, status, code) => {
    const response = await get(name);

    expect(response.statusCode).toBe(status);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code,
      message: expect.any(String),
    });
  });

  it('answers an invalid CV upload with 400 validation_error naming file', async () => {
    const response = await get('invalid-cv-upload');

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'validation_error',
      message: expect.any(String),
      fields: ['file'],
    });
  });

  it('answers a spent CV window with 429 and its Retry-After', async () => {
    const response = await get('too-many-cv-attempts');

    expect(response.statusCode).toBe(429);
    expect(response.json()).toEqual({
      code: 'too_many_attempts',
      message: expect.any(String),
    });
    // Sin su rama propia, la genérica de `CvError` respondería el mismo código sin la cabecera.
    expect(response.headers['retry-after']).toBe('742');
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
