import { describe, expect, it } from 'vitest';
import {
  apiErrorCodeSchema,
  apiErrorResponseSchema,
  changePasswordRequestSchema,
  loginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registerRequestSchema,
  sessionResponseSchema,
} from './auth.schema';

function issuePaths(result: {
  success: boolean;
  error?: { issues: readonly { path: readonly PropertyKey[] }[] };
}): string[] {
  return [
    ...new Set(
      (result.error?.issues ?? []).map((issue) => String(issue.path[0])),
    ),
  ].sort();
}

const VALID_PASSWORD = 'correct-horse-battery';

describe('registerRequestSchema', () => {
  it('normalizes the email by trimming and lowercasing it', () => {
    const result = registerRequestSchema.parse({
      email: '  Ana@Example.com ',
      password: VALID_PASSWORD,
      displayName: 'Ana',
    });

    expect(result.email).toBe('ana@example.com');
  });

  it('trims displayName', () => {
    const result = registerRequestSchema.parse({
      email: 'ana@example.com',
      password: VALID_PASSWORD,
      displayName: '  Ana  ',
    });

    expect(result.displayName).toBe('Ana');
  });

  it('Registro inválido', () => {
    const result = registerRequestSchema.safeParse({
      email: 'ana.example.com',
      password: VALID_PASSWORD,
      displayName: '',
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(['displayName', 'email']);
  });

  it.each([
    ['', false],
    ['   ', false],
    ['A', true],
    ['a'.repeat(60), true],
    [`  ${'a'.repeat(60)}  `, true],
    ['a'.repeat(61), false],
  ])('displayName %j is valid: %s', (displayName, valid) => {
    const result = registerRequestSchema.safeParse({
      email: 'ana@example.com',
      password: VALID_PASSWORD,
      displayName,
    });

    expect(result.success).toBe(valid);
    if (!valid) {
      expect(issuePaths(result)).toEqual(['displayName']);
    }
  });

  it.each([
    [9, false],
    [10, true],
    [128, true],
    [129, false],
  ])('password of %i characters is valid: %s', (length, valid) => {
    const result = registerRequestSchema.safeParse({
      email: 'ana@example.com',
      password: 'p'.repeat(length),
      displayName: 'Ana',
    });

    expect(result.success).toBe(valid);
    if (!valid) {
      expect(issuePaths(result)).toEqual(['password']);
    }
  });

  it('exposes the password length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  it('Contraseña igual al email', () => {
    const result = registerRequestSchema.safeParse({
      email: 'ana@example.com',
      password: 'ana@example.com',
      displayName: 'Ana',
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(['password']);
  });

  it('rejects a password equal to the normalized email', () => {
    const result = registerRequestSchema.safeParse({
      email: ' Ana@Example.com ',
      password: 'ana@example.com',
      displayName: 'Ana',
    });

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toEqual(['password']);
  });

  it('does not require character composition', () => {
    expect(
      registerRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'aaaaaaaaaa',
        displayName: 'Ana',
      }).success,
    ).toBe(true);
  });
});

describe('loginRequestSchema', () => {
  it('normalizes the email', () => {
    expect(
      loginRequestSchema.parse({
        email: 'Ana@example.com',
        password: VALID_PASSWORD,
      }).email,
    ).toBe('ana@example.com');
  });

  it('does not apply the password policy, so a wrong short password is a credential failure', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'ana@example.com', password: 'x' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty password and one longer than the maximum', () => {
    expect(
      loginRequestSchema.safeParse({ email: 'ana@example.com', password: '' })
        .success,
    ).toBe(false);
    expect(
      loginRequestSchema.safeParse({
        email: 'ana@example.com',
        password: 'p'.repeat(PASSWORD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });
});

describe('changePasswordRequestSchema', () => {
  it.each([
    [9, false],
    [10, true],
    [128, true],
    [129, false],
  ])('newPassword of %i characters is valid: %s', (length, valid) => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: VALID_PASSWORD,
      newPassword: 'p'.repeat(length),
    });

    expect(result.success).toBe(valid);
    if (!valid) {
      expect(issuePaths(result)).toEqual(['newPassword']);
    }
  });

  it('requires currentPassword', () => {
    const result = changePasswordRequestSchema.safeParse({
      currentPassword: '',
      newPassword: VALID_PASSWORD,
    });

    expect(issuePaths(result)).toEqual(['currentPassword']);
  });
});

describe('sessionResponseSchema', () => {
  const session = {
    accessToken: 'header.payload.signature',
    expiresIn: 900,
    user: {
      id: '66e9a0000000000000000001',
      email: 'ana@example.com',
      displayName: 'Ana',
      emailVerified: true,
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: '2026-09-20',
      },
      outputLanguage: 'es',
      redactName: false,
      createdAt: '2026-09-17T10:00:00.000Z',
    },
  } as const;

  it('accepts the session contract', () => {
    expect(sessionResponseSchema.parse(session)).toEqual(session);
  });

  it('rejects a password hash in the user profile', () => {
    expect(
      sessionResponseSchema.safeParse({
        ...session,
        user: { ...session.user, passwordHash: '$argon2id$v=19$...' },
      }).success,
    ).toBe(false);
  });
});

describe('api error contract', () => {
  it('lists the error codes of the auth, profile, group and link endpoints', () => {
    expect(apiErrorCodeSchema.options).toEqual([
      'validation_error',
      'invalid_credentials',
      'email_taken',
      'too_many_attempts',
      'invalid_refresh',
      'refresh_conflict',
      'csrf_header_missing',
      'unauthorized',
      'invalid_token',
      'unsupported_media_type',
      'group_not_found',
      'member_not_found',
      'forbidden',
      'invalid_invite_code',
      'group_full',
      'too_many_groups',
      'owner_cannot_leave',
      'already_owner',
      'sole_owner_with_members',
      'invalid_url',
      'text_too_long',
      'link_not_found',
      'comment_not_found',
      'preview_field_unknown',
      'enrichment_not_retryable',
      'not_a_job_posting',
      'extraction_unavailable',
      'ai_quota_exceeded',
      'application_not_found',
      'application_conflict',
      'cv_not_found',
      'unsupported_file_type',
      'file_too_large',
      'too_many_cvs',
      'analysis_not_found',
      'no_cv',
      'cv_not_ready',
      'cv_not_readable',
      'job_not_ready',
      'roadmap_not_eligible',
      'consent_text_outdated',
      'vault_unavailable',
      'internal_error',
    ]);
  });

  it('keeps analysis_not_found apart from link_not_found', () => {
    expect(apiErrorCodeSchema.options).toContain('analysis_not_found');
    expect(apiErrorCodeSchema.options).toContain('link_not_found');
  });

  it('keeps unsupported_media_type apart from unsupported_file_type', () => {
    expect(apiErrorCodeSchema.options).toContain('unsupported_media_type');
    expect(apiErrorCodeSchema.options).toContain('unsupported_file_type');
  });

  it('accepts an error body with field names', () => {
    const body = {
      code: 'validation_error',
      message: 'Invalid request',
      fields: ['email', 'displayName'],
    } as const;

    expect(apiErrorResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects unknown codes and extra properties', () => {
    expect(
      apiErrorResponseSchema.safeParse({ code: 'teapot', message: 'x' })
        .success,
    ).toBe(false);
    expect(
      apiErrorResponseSchema.safeParse({
        code: 'validation_error',
        message: 'x',
        values: { email: 'ana@example.com' },
      }).success,
    ).toBe(false);
  });
});
