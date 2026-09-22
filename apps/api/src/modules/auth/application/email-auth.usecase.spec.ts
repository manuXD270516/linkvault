import { beforeEach, describe, expect, it } from 'vitest';
import {
  FORGOT_PASSWORD_ATTEMPTS_PER_EMAIL,
  VERIFY_RESEND_ATTEMPTS_PER_EMAIL,
} from '../domain/attempt-limits';
import {
  InvalidAccessToken,
  InvalidEmailToken,
  PasswordPolicyViolation,
  TooManyAttempts,
} from '../domain/errors';
import { ForgotPassword } from './forgot-password.usecase';
import { Register } from './register.usecase';
import { ResendVerificationEmail } from './resend-verification-email.usecase';
import { ResetPassword } from './reset-password.usecase';
import {
  createAuthTestHarness,
  type AuthTestHarness,
} from './testing/auth-test-harness';
import { VerifyEmail } from './verify-email.usecase';
import { hashEmailToken } from './email-token';

const IP = '203.0.113.9';
const PASSWORD = 'correct-horse-battery';

describe('email verification and password recovery', () => {
  let harness: AuthTestHarness;
  let register: Register;
  let verifyEmail: VerifyEmail;
  let resend: ResendVerificationEmail;
  let forgot: ForgotPassword;
  let reset: ResetPassword;

  beforeEach(() => {
    harness = createAuthTestHarness();
    register = new Register(
      harness.accounts,
      harness.hasher,
      harness.limiter,
      harness.sessionOpener,
      harness.emailSender,
    );
    verifyEmail = new VerifyEmail(
      harness.emailTokens,
      harness.accounts,
      harness.clock,
    );
    resend = new ResendVerificationEmail(
      harness.accounts,
      harness.limiter,
      harness.emailSender,
    );
    forgot = new ForgotPassword(
      harness.accounts,
      harness.limiter,
      harness.emailSender,
    );
    reset = new ResetPassword(
      harness.emailTokens,
      harness.accounts,
      harness.hasher,
      harness.sessions,
      harness.limiter,
      harness.clock,
    );
  });

  async function registerAna() {
    return register.execute({
      email: 'ana@example.com',
      password: PASSWORD,
      displayName: 'Ana',
      ip: IP,
    });
  }

  function tokenFromMail(templateId: 'email-verification' | 'password-reset') {
    const mail = harness.mailer.messages.find(
      (message) => message.templateId === templateId,
    );
    expect(mail).toBeDefined();
    const url = new URL(mail!.variables.actionUrl);
    const token = url.searchParams.get('token');
    expect(token).toBeTruthy();
    return token!;
  }

  it('Registro deja la cuenta sin verificar y captura el correo', async () => {
    const session = await registerAna();
    expect(session.user.emailVerified).toBe(false);
    expect(harness.mailer.lastTo('ana@example.com')?.templateId).toBe(
      'email-verification',
    );
    expect(
      harness.emailTokens.containsPlain(tokenFromMail('email-verification')),
    ).toBe(false);
  });

  it('Fallo al persistir el token no tumba el registro', async () => {
    harness.emailTokens.failIssueWith = new Error('disk full');
    const session = await registerAna();
    expect(session.user.emailVerified).toBe(false);
    expect(harness.mailer.messages).toHaveLength(0);
  });

  it('Verificación correcta e invalid_token al reusar', async () => {
    await registerAna();
    const token = tokenFromMail('email-verification');

    await verifyEmail.execute({ token });
    const profile = await harness.accounts.getProfile(
      (await harness.accounts.findCredentialsByEmail('ana@example.com'))!
        .userId,
    );
    expect(profile?.emailVerified).toBe(true);

    await expect(verifyEmail.execute({ token })).rejects.toBeInstanceOf(
      InvalidEmailToken,
    );
  });

  it('Token inventado → invalid_token', async () => {
    await expect(
      verifyEmail.execute({ token: 'not-a-real-token' }),
    ).rejects.toBeInstanceOf(InvalidEmailToken);
  });

  it('Resend autenticado ignora email ajeno', async () => {
    const session = await registerAna();
    harness.mailer.clear();

    const ack = await resend.execute({ userId: session.user.id, ip: IP });
    expect(ack.message).toBeTruthy();
    expect(harness.mailer.lastTo('ana@example.com')?.to).toBe('ana@example.com');
    expect(harness.mailer.messages.every((m) => m.to === 'ana@example.com')).toBe(
      true,
    );
  });

  it('Resend sin usuario → unauthorized', async () => {
    await expect(
      resend.execute({ userId: 'missing', ip: IP }),
    ).rejects.toBeInstanceOf(InvalidAccessToken);
  });

  it('Límite de reenvíos', async () => {
    const session = await registerAna();
    for (let i = 0; i < VERIFY_RESEND_ATTEMPTS_PER_EMAIL; i++) {
      await resend.execute({ userId: session.user.id, ip: IP });
    }
    await expect(
      resend.execute({ userId: session.user.id, ip: IP }),
    ).rejects.toBeInstanceOf(TooManyAttempts);
  });

  it('Forgot con cuenta existente emite correo; inexistente no', async () => {
    await registerAna();
    harness.mailer.clear();

    const existing = await forgot.execute({
      email: 'Ana@example.com',
      ip: IP,
    });
    const missing = await forgot.execute({
      email: 'nadie@example.com',
      ip: '198.51.100.1',
    });

    expect(existing.message).toBe(missing.message);
    expect(harness.mailer.lastTo('ana@example.com')?.templateId).toBe(
      'password-reset',
    );
    expect(harness.mailer.lastTo('nadie@example.com')).toBeUndefined();
  });

  it('Límite de forgot-password', async () => {
    for (let i = 0; i < FORGOT_PASSWORD_ATTEMPTS_PER_EMAIL; i++) {
      await forgot.execute({ email: 'ana@example.com', ip: `${IP}.${i}` });
    }
    await expect(
      forgot.execute({ email: 'ana@example.com', ip: '198.51.100.9' }),
    ).rejects.toBeInstanceOf(TooManyAttempts);
  });

  it('Reset correcto: revoca sesiones, cambia hash y limpia login-email', async () => {
    const first = await registerAna();
    await harness.sessionOpener.open(first.user);
    const sessionIds = [...harness.sessions.sessions.keys()];
    expect(sessionIds.length).toBe(2);

    await forgot.execute({ email: 'ana@example.com', ip: IP });
    const token = tokenFromMail('password-reset');

    for (let i = 0; i < 5; i++) {
      await harness.limiter.consume(
        { kind: 'login-email', email: 'ana@example.com' },
        5,
      );
    }
    expect(
      (
        await harness.limiter.consume(
          { kind: 'login-email', email: 'ana@example.com' },
          5,
        )
      ).allowed,
    ).toBe(false);

    await reset.execute({ token, newPassword: 'new-correct-horse' });

    for (const sessionId of sessionIds) {
      expect(harness.sessions.isActive(sessionId)).toBe(false);
    }
    expect(harness.accounts.passwordHashOf(first.user.id)).toBe(
      'fake-argon2id$new-correct-horse',
    );
    expect(
      (
        await harness.limiter.consume(
          { kind: 'login-email', email: 'ana@example.com' },
          5,
        )
      ).allowed,
    ).toBe(true);
    await expect(
      reset.execute({ token, newPassword: 'another-valid-pw' }),
    ).rejects.toBeInstanceOf(InvalidEmailToken);
  });

  it('Orden revocar antes del hash', async () => {
    await registerAna();
    await forgot.execute({ email: 'ana@example.com', ip: IP });
    const token = tokenFromMail('password-reset');
    const before = harness.accounts.passwordHashOf(
      (await harness.accounts.findCredentialsByEmail('ana@example.com'))!.userId,
    );
    harness.sessions.failRevokeWith = new Error('revoke failed');

    await expect(
      reset.execute({ token, newPassword: 'new-correct-horse' }),
    ).rejects.toThrow('revoke failed');
    expect(
      harness.accounts.passwordHashOf(
        (await harness.accounts.findCredentialsByEmail('ana@example.com'))!
          .userId,
      ),
    ).toBe(before);
  });

  it('Contraseña nueva inválida no consume el token', async () => {
    await registerAna();
    await forgot.execute({ email: 'ana@example.com', ip: IP });
    const token = tokenFromMail('password-reset');

    await expect(
      reset.execute({ token, newPassword: 'short' }),
    ).rejects.toBeInstanceOf(PasswordPolicyViolation);

    await reset.execute({ token, newPassword: 'new-correct-horse' });
    expect(
      harness.emailTokens.hasHash(hashEmailToken(token)),
    ).toBe(true);
  });

  it('Token de reset caducado', async () => {
    await registerAna();
    await forgot.execute({ email: 'ana@example.com', ip: IP });
    const token = tokenFromMail('password-reset');
    harness.clock.advance(3600_001);

    await expect(
      reset.execute({ token, newPassword: 'new-correct-horse' }),
    ).rejects.toBeInstanceOf(InvalidEmailToken);
  });
});
