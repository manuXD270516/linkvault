import { beforeEach, describe, expect, it } from 'vitest';
import { REGISTRATIONS_PER_IP } from '../domain/attempt-limits';
import {
  EmailTaken,
  PasswordPolicyViolation,
  TooManyAttempts,
} from '../domain/errors';
import { hashRefreshToken } from './refresh-token';
import { Register, type RegisterInput } from './register.usecase';
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from './testing/auth-test-harness';

const IP = '203.0.113.7';

function input(overrides: Partial<RegisterInput> = {}): RegisterInput {
  return {
    email: '  Ana@Example.com ',
    password: 'correct-horse-battery',
    displayName: 'Ana',
    ip: IP,
    ...overrides,
  };
}

describe('Register', () => {
  let harness: AuthTestHarness;
  let register: Register;

  beforeEach(() => {
    harness = createAuthTestHarness();
    register = new Register(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
    );
  });

  it('Registro correcto', async () => {
    const session = await register.execute(input());

    expect(session.user).toMatchObject({
      email: 'ana@example.com',
      displayName: 'Ana',
      aiConsent: { externalProviders: false },
      outputLanguage: 'es',
      redactName: false,
    });
    expect(session.expiresIn).toBe(900);
    expect(await harness.signer.verify(session.accessToken)).toMatchObject({
      userId: session.user.id,
    });
    expect(session.refreshExpiresAt).toEqual(
      new Date(harness.clock.now().getTime() + 30 * 86_400_000),
    );
    const stored = await harness.sessions.findRefreshToken(
      hashRefreshToken(session.refreshToken),
    );
    expect(stored).toMatchObject({ userId: session.user.id, rotatedAt: null });
    const credentials =
      await harness.accounts.findCredentialsByEmail('ana@example.com');
    expect(credentials?.passwordHash).toBe(
      'fake-argon2id$correct-horse-battery',
    );
  });

  it('Email ya registrado', async () => {
    await register.execute(input({ email: 'ana@example.com' }));
    const sessionsBefore = harness.sessions.sessions.size;

    await expect(
      register.execute(
        input({ email: 'ANA@example.com', displayName: 'Otra' }),
      ),
    ).rejects.toBeInstanceOf(EmailTaken);

    expect(harness.accounts.size).toBe(1);
    expect(harness.sessions.sessions.size).toBe(sessionsBefore);
  });

  it('limits registrations per IP, counting every attempt, without hashing', async () => {
    for (let i = 0; i < REGISTRATIONS_PER_IP; i++) {
      await register
        .execute(input({ email: `user${i}@example.com` }))
        .catch(() => undefined);
    }
    const hashesBefore = harness.hasher.hashes;

    const rejection = register.execute(input({ email: 'late@example.com' }));

    await expect(rejection).rejects.toBeInstanceOf(TooManyAttempts);
    await expect(rejection).rejects.toMatchObject({
      retryAfterSeconds: 900,
    });
    expect(harness.hasher.hashes).toBe(hashesBefore);
    expect(
      await harness.accounts.findCredentialsByEmail('late@example.com'),
    ).toBeNull();
    expect(harness.limiter.consumed).toContainEqual({
      kind: 'register-ip',
      ip: IP,
    });
  });

  it('counts a registration with an email already taken', async () => {
    await register.execute(input({ email: 'ana@example.com' }));
    await register
      .execute(input({ email: 'ana@example.com' }))
      .catch(() => undefined);

    expect(harness.limiter.count({ kind: 'register-ip', ip: IP })).toBe(2);
  });

  it.each([
    ['a short password', 'short-pw', 'too_short'],
    ['a password equal to the email', 'ana@example.com', 'matches_email'],
  ])(
    'rejects %s naming password before creating anything',
    async (_, password, violation) => {
      await expect(register.execute(input({ password }))).rejects.toMatchObject(
        {
          name: PasswordPolicyViolation.name,
          field: 'password',
          violation,
        },
      );
      expect(harness.accounts.size).toBe(0);
      expect(harness.hasher.hashes).toBe(0);
    },
  );

  it('Fallo al abrir la sesión tras crear el usuario', async () => {
    harness.sessions.failOpenWith = new Error('session store down');

    await expect(register.execute(input())).rejects.toThrow(
      'session store down',
    );

    // El usuario ya existe con su contraseña: un login posterior con ella verifica (ver login.usecase.spec).
    const credentials =
      await harness.accounts.findCredentialsByEmail('ana@example.com');
    expect(credentials).not.toBeNull();
    expect(
      await harness.hasher.verify(
        credentials?.passwordHash ?? '',
        'correct-horse-battery',
      ),
    ).toBe(true);
    harness.sessions.failOpenWith = null;
    await expect(register.execute(input())).rejects.toBeInstanceOf(EmailTaken);
  });
});
