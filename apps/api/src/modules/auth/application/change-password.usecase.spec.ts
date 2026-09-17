import { beforeEach, describe, expect, it } from 'vitest';
import { LOGIN_ATTEMPTS_PER_EMAIL } from '../domain/attempt-limits';
import {
  InvalidAccessToken,
  InvalidCredentials,
  InvalidRefresh,
  PasswordPolicyViolation,
  TooManyAttempts,
} from '../domain/errors';
import {
  ChangePassword,
  type ChangePasswordInput,
} from './change-password.usecase';
import type { IssuedSession } from './issued-session';
import { Login } from './login.usecase';
import { hashRefreshToken } from './refresh-token';
import { RefreshSession } from './refresh-session.usecase';
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from './testing/auth-test-harness';

const IP = '203.0.113.7';
const OLD_PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'new-staple-battery-horse';

describe('ChangePassword', () => {
  let harness: AuthTestHarness;
  let changePassword: ChangePassword;
  let login: Login;
  let refresh: RefreshSession;
  let sessionA: IssuedSession;
  let sessionB: IssuedSession;
  let sessionIdA: string;

  beforeEach(async () => {
    harness = createAuthTestHarness();
    changePassword = new ChangePassword(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessions,
    );
    login = new Login(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
    );
    refresh = new RefreshSession(
      harness.sessions,
      harness.signer,
      harness.accounts,
      harness.securityLog,
    );
    await harness.accounts.createWithPassword({
      email: 'ana@example.com',
      passwordHash: await harness.hasher.hash(OLD_PASSWORD),
      displayName: 'Ana',
    });
    const credentials = {
      email: 'ana@example.com',
      password: OLD_PASSWORD,
      ip: IP,
    };
    sessionA = await login.execute(credentials);
    sessionB = await login.execute(credentials);
    sessionIdA =
      (
        await harness.sessions.findRefreshToken(
          hashRefreshToken(sessionA.refreshToken),
        )
      )?.sessionId ?? '';
  });

  function input(
    overrides: Partial<ChangePasswordInput> = {},
  ): ChangePasswordInput {
    return {
      userId: sessionA.user.id,
      sessionId: sessionIdA,
      currentPassword: OLD_PASSWORD,
      newPassword: NEW_PASSWORD,
      ...overrides,
    };
  }

  it('Cambio correcto revoca las otras sesiones', async () => {
    const changedAt = new Date(harness.clock.now().getTime() + 5_000);
    harness.clock.current = changedAt;

    await expect(changePassword.execute(input())).resolves.toBeUndefined();

    await expect(
      refresh.execute({ refreshToken: sessionB.refreshToken }),
    ).rejects.toMatchObject({
      name: InvalidRefresh.name,
      reason: 'session_revoked',
    });
    await expect(
      refresh.execute({ refreshToken: sessionA.refreshToken }),
    ).resolves.toBeDefined();
    await expect(
      login.execute({
        email: 'ana@example.com',
        password: OLD_PASSWORD,
        ip: IP,
      }),
    ).rejects.toBeInstanceOf(InvalidCredentials);
    await expect(
      login.execute({
        email: 'ana@example.com',
        password: NEW_PASSWORD,
        ip: IP,
      }),
    ).resolves.toBeDefined();
    expect(await harness.accounts.getAuthState(sessionA.user.id)).toEqual({
      userId: sessionA.user.id,
      passwordChangedAt: changedAt,
    });
  });

  it('Contraseña actual incorrecta', async () => {
    const hashBefore = harness.accounts.passwordHashOf(sessionA.user.id);

    await expect(
      changePassword.execute(input({ currentPassword: 'wrong-password-1' })),
    ).rejects.toBeInstanceOf(InvalidCredentials);

    expect(harness.accounts.passwordHashOf(sessionA.user.id)).toBe(hashBefore);
    await expect(
      refresh.execute({ refreshToken: sessionB.refreshToken }),
    ).resolves.toBeDefined();
  });

  it('Fuerza bruta de la contraseña actual', async () => {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_EMAIL; i++) {
      await expect(
        changePassword.execute(input({ currentPassword: 'wrong-password-1' })),
      ).rejects.toBeInstanceOf(InvalidCredentials);
    }
    const verificationsBefore = harness.hasher.anyVerifications;

    await expect(changePassword.execute(input())).rejects.toBeInstanceOf(
      TooManyAttempts,
    );

    expect(harness.hasher.anyVerifications).toBe(verificationsBefore);
    expect(harness.limiter.consumed.at(-1)).toEqual({
      kind: 'login-email',
      email: 'ana@example.com',
    });
  });

  it('shares the email counter with login', async () => {
    for (let i = 0; i < LOGIN_ATTEMPTS_PER_EMAIL; i++) {
      await login
        .execute({
          email: 'ana@example.com',
          password: 'wrong-password-1',
          ip: IP,
        })
        .catch(() => undefined);
    }

    await expect(changePassword.execute(input())).rejects.toBeInstanceOf(
      TooManyAttempts,
    );
  });

  it('does not change the hash when revoking the other sessions fails', async () => {
    const hashBefore = harness.accounts.passwordHashOf(sessionA.user.id);
    harness.sessions.failRevokeWith = new Error('session store down');

    await expect(changePassword.execute(input())).rejects.toThrow(
      'session store down',
    );

    expect(harness.accounts.passwordHashOf(sessionA.user.id)).toBe(hashBefore);
    await expect(
      login.execute({
        email: 'ana@example.com',
        password: OLD_PASSWORD,
        ip: IP,
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['too short', 'short-pw', 'too_short'],
    ['equal to the email', 'ana@example.com', 'matches_email'],
  ])(
    'rejects a new password %s naming newPassword without changing anything',
    async (_, newPassword, violation) => {
      const hashBefore = harness.accounts.passwordHashOf(sessionA.user.id);

      await expect(
        changePassword.execute(input({ newPassword })),
      ).rejects.toMatchObject({
        name: PasswordPolicyViolation.name,
        field: 'newPassword',
        violation,
      });

      expect(harness.accounts.passwordHashOf(sessionA.user.id)).toBe(
        hashBefore,
      );
      expect(harness.sessions.isActive(sessionIdA)).toBe(true);
    },
  );

  it('resets the email counter after a successful change', async () => {
    await changePassword
      .execute(input({ currentPassword: 'wrong-password-1' }))
      .catch(() => undefined);

    await changePassword.execute(input());

    expect(
      harness.limiter.count({ kind: 'login-email', email: 'ana@example.com' }),
    ).toBe(0);
  });

  it('rejects the request of a user that no longer exists as unauthorized', async () => {
    await expect(
      changePassword.execute(input({ userId: 'missing-user' })),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });
});
