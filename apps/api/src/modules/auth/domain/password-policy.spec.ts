import {
  changePasswordRequestSchema,
  PASSWORD_MAX_LENGTH as SHARED_PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH as SHARED_PASSWORD_MIN_LENGTH,
  registerRequestSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { PasswordPolicyViolation } from './errors';
import {
  assertPasswordPolicy,
  checkPasswordPolicy,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from './password-policy';

const EMAIL = 'ana@example.com';

describe('checkPasswordPolicy', () => {
  it.each([
    [9, 'too_short'],
    [10, null],
    [128, null],
    [129, 'too_long'],
  ] as const)('a password of %i characters gives %s', (length, violation) => {
    expect(checkPasswordPolicy('p'.repeat(length), EMAIL)).toBe(violation);
  });

  it('Contraseña igual al email', () => {
    expect(checkPasswordPolicy('ana@example.com', 'ana@example.com')).toBe(
      'matches_email',
    );
  });

  it('compares against the normalized email', () => {
    expect(checkPasswordPolicy('ana@example.com', '  Ana@Example.com ')).toBe(
      'matches_email',
    );
  });

  it('accepts a password that only differs from the email in case', () => {
    expect(
      checkPasswordPolicy('Ana@Example.com', 'ana@example.com'),
    ).toBeNull();
  });

  it('does not require character composition', () => {
    expect(checkPasswordPolicy('aaaaaaaaaa', EMAIL)).toBeNull();
  });

  it('uses the same limits as the shared contract', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(SHARED_PASSWORD_MIN_LENGTH);
    expect(PASSWORD_MAX_LENGTH).toBe(SHARED_PASSWORD_MAX_LENGTH);
  });

  // Mismo criterio de longitud que zod 4 (code points): el SPA, el contrato y el dominio no pueden discrepar.
  it.each([
    'p'.repeat(9),
    'p'.repeat(10),
    'p'.repeat(128),
    'p'.repeat(129),
    '🔑'.repeat(5),
    `${'🔑'.repeat(4)}a`,
    '🔑'.repeat(128),
    '🔑'.repeat(129),
    'ana@example.com',
  ])('agrees with registerRequestSchema for %j', (password) => {
    const contract = registerRequestSchema.safeParse({
      email: EMAIL,
      password,
      displayName: 'Ana',
    }).success;

    expect(checkPasswordPolicy(password, EMAIL) === null).toBe(contract);
  });
});

describe('assertPasswordPolicy', () => {
  it('passes a valid password', () => {
    expect(() =>
      assertPasswordPolicy({
        password: 'correct-horse-battery',
        email: EMAIL,
        field: 'password',
      }),
    ).not.toThrow();
  });

  it('names the new password field when it matches the email, which the change contract cannot check', () => {
    const newPassword = 'ana@example.com';
    expect(
      changePasswordRequestSchema.safeParse({
        currentPassword: 'old-password-123',
        newPassword,
      }).success,
    ).toBe(true);

    expect(() =>
      assertPasswordPolicy({
        password: newPassword,
        email: EMAIL,
        field: 'newPassword',
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'PasswordPolicyViolation',
        field: 'newPassword',
        violation: 'matches_email',
      }),
    );
  });

  it('never includes the password in the error message', () => {
    const password = 'short-pw';

    let caught: unknown;
    try {
      assertPasswordPolicy({ password, email: EMAIL, field: 'password' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(PasswordPolicyViolation);
    expect((caught as Error).message).not.toContain(password);
    expect((caught as Error).message).not.toContain(EMAIL);
  });
});
