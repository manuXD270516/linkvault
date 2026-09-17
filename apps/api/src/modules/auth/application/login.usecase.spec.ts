import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOGIN_ATTEMPTS_PER_EMAIL,
  LOGIN_ATTEMPTS_PER_IP,
} from '../domain/attempt-limits';
import { InvalidCredentials, TooManyAttempts } from '../domain/errors';
import { Login, type LoginInput } from './login.usecase';
import { hashRefreshToken } from './refresh-token';
import { Register } from './register.usecase';
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from './testing/auth-test-harness';

const IP = '203.0.113.7';
const PASSWORD = 'correct-horse-battery';

describe('Login', () => {
  let harness: AuthTestHarness;
  let login: Login;
  let register: Register;

  beforeEach(async () => {
    harness = createAuthTestHarness();
    login = new Login(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
    );
    register = new Register(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
    );
    await harness.accounts.createWithPassword({
      email: 'ana@example.com',
      passwordHash: await harness.hasher.hash(PASSWORD),
      displayName: 'Ana',
    });
    harness.hasher.hashes = 0;
  });

  function attempt(overrides: Partial<LoginInput> = {}): Promise<unknown> {
    return login.execute({
      email: 'ana@example.com',
      password: PASSWORD,
      ip: IP,
      ...overrides,
    });
  }

  async function failTimes(times: number, email = 'ana@example.com') {
    for (let i = 0; i < times; i++) {
      await expect(
        attempt({ email, password: 'wrong-password-1' }),
      ).rejects.toBeInstanceOf(InvalidCredentials);
    }
  }

  it('Login correcto', async () => {
    const session = await login.execute({
      email: 'Ana@example.com',
      password: PASSWORD,
      ip: IP,
    });

    expect(session.user.email).toBe('ana@example.com');
    expect(session.expiresIn).toBe(900);
    expect(
      await harness.sessions.findRefreshToken(
        hashRefreshToken(session.refreshToken),
      ),
    ).toMatchObject({ userId: session.user.id });
    expect(await harness.signer.verify(session.accessToken)).toMatchObject({
      userId: session.user.id,
    });
  });

  it('opens a new session on every login', async () => {
    await attempt();
    await attempt();

    expect(harness.sessions.sessions.size).toBe(2);
  });

  it('Credenciales inválidas indistinguibles', async () => {
    const wrongPassword = await login
      .execute({
        email: 'ana@example.com',
        password: 'wrong-password-1',
        ip: IP,
      })
      .catch((error: unknown) => error);
    const unknownEmail = await login
      .execute({ email: 'nadie@example.com', password: PASSWORD, ip: IP })
      .catch((error: unknown) => error);

    expect(wrongPassword).toBeInstanceOf(InvalidCredentials);
    expect(unknownEmail).toBeInstanceOf(InvalidCredentials);
    expect((unknownEmail as Error).message).toBe(
      (wrongPassword as Error).message,
    );
    // Ambas verifican un hash: la real contra el usuario y la ficticia para el email inexistente.
    expect(harness.hasher.verifications).toBe(1);
    expect(harness.hasher.dummyVerifications).toBe(1);
    expect(harness.sessions.sessions.size).toBe(0);
  });

  it('Demasiados fallos por email', async () => {
    await failTimes(LOGIN_ATTEMPTS_PER_EMAIL);
    const verificationsBefore = harness.hasher.anyVerifications;

    const rejection = attempt();

    await expect(rejection).rejects.toBeInstanceOf(TooManyAttempts);
    await expect(rejection).rejects.toMatchObject({
      retryAfterSeconds: expect.any(Number),
    });
    const error = await rejection.catch((caught: unknown) => caught);
    expect((error as TooManyAttempts).retryAfterSeconds).toBeGreaterThan(0);
    expect(harness.hasher.anyVerifications).toBe(verificationsBefore);
  });

  it('Email inexistente también se limita', async () => {
    await failTimes(LOGIN_ATTEMPTS_PER_EMAIL, 'nadie@example.com');

    await expect(
      attempt({ email: 'nadie@example.com' }),
    ).rejects.toBeInstanceOf(TooManyAttempts);
  });

  it('counts the email limit on the normalized email', async () => {
    await failTimes(LOGIN_ATTEMPTS_PER_EMAIL, '  ANA@example.com ');

    await expect(attempt()).rejects.toBeInstanceOf(TooManyAttempts);
  });

  it('Login correcto reinicia el contador', async () => {
    await failTimes(4);
    await attempt();

    await failTimes(4);

    await expect(attempt()).resolves.toBeDefined();
  });

  it('limits failed logins per IP across emails', async () => {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_IP; i++) {
      await attempt({
        email: `nadie${i}@example.com`,
        password: 'wrong-password-1',
      }).catch(() => undefined);
    }

    await expect(attempt()).rejects.toBeInstanceOf(TooManyAttempts);
  });

  it('Logins correctos no agotan el límite por IP', async () => {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_IP + 1; i++) {
      await expect(attempt()).resolves.toBeDefined();
    }
  });

  it('counts both keys before verifying', async () => {
    await attempt({ password: 'wrong-password-1' }).catch(() => undefined);

    expect(harness.limiter.consumed).toEqual([
      { kind: 'login-email', email: 'ana@example.com' },
      { kind: 'login-ip', ip: IP },
    ]);
  });

  it('Fallo al abrir la sesión tras crear el usuario', async () => {
    harness.sessions.failOpenWith = new Error('session store down');
    await expect(
      register.execute({
        email: 'nueva@example.com',
        password: PASSWORD,
        displayName: 'Nueva',
        ip: IP,
      }),
    ).rejects.toThrow('session store down');
    harness.sessions.failOpenWith = null;

    const session = await login.execute({
      email: 'nueva@example.com',
      password: PASSWORD,
      ip: IP,
    });

    expect(session.user.email).toBe('nueva@example.com');
  });
});
