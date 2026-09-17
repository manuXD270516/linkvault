import { apiErrorCodeSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  AuthError,
  EmailTaken,
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefresh,
  PasswordPolicyViolation,
  RefreshConflict,
  TooManyAttempts,
} from './errors';

describe('auth domain errors', () => {
  it.each([
    [new InvalidCredentials(), 'invalid_credentials'],
    [new EmailTaken(), 'email_taken'],
    [new TooManyAttempts(600), 'too_many_attempts'],
    [new InvalidRefresh('unknown_token'), 'invalid_refresh'],
    [new RefreshConflict(), 'refresh_conflict'],
    [new InvalidAccessToken(), 'unauthorized'],
    [
      new PasswordPolicyViolation('newPassword', 'too_short'),
      'validation_error',
    ],
  ] as const)('%s carries the API code %s', (error, code) => {
    expect(error).toBeInstanceOf(AuthError);
    expect(error.code).toBe(code);
  });

  it('only uses codes of the shared error contract', () => {
    const codes = [
      new InvalidCredentials(),
      new EmailTaken(),
      new TooManyAttempts(1),
      new InvalidRefresh('missing_token'),
      new RefreshConflict(),
      new InvalidAccessToken(),
      new PasswordPolicyViolation('password', 'too_long'),
    ].map((error) => error.code);

    for (const code of codes) {
      expect(apiErrorCodeSchema.options).toContain(code);
    }
  });

  it('gives the same message for a missing account and a wrong password', () => {
    expect(new InvalidCredentials().message).toBe(
      new InvalidCredentials().message,
    );
  });

  it('keeps Retry-After in whole seconds, at least 1', () => {
    expect(new TooManyAttempts(599.2).retryAfterSeconds).toBe(600);
    expect(new TooManyAttempts(0).retryAfterSeconds).toBe(1);
  });

  it('keeps the invalid refresh reason for logs', () => {
    expect(new InvalidRefresh('reused').reason).toBe('reused');
  });
});
