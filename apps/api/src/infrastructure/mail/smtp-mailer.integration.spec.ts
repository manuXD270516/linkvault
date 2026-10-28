import {
  startTestSmtpServer,
  TEST_SMTP_CERT,
  type TestSmtpServer,
} from '@linkvault/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailMessage } from './mailer.port';
import { SmtpMailer } from './smtp-mailer';

// Tarea 7.5 de `staging-host` (design D6; spec `platform/email`): el adaptador SMTP de `api` contra el servidor en
// proceso de `@linkvault/testing`, que exige AUTH tras STARTTLS con un certificado que solo confía este test.

const USER = 'usuario-smtp-de-prueba';
const PASSWORD = 'clave-smtp-de-prueba';
const MESSAGE: MailMessage = {
  to: 'ana@example.invalid',
  templateId: 'email-verification',
  locale: 'es',
  variables: {
    displayName: 'Ana',
    actionUrl: 'http://localhost:4200/verificar-email?token=t',
    expiresInHuman: '24 horas',
  },
};

let server: TestSmtpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function mailer(
  target: TestSmtpServer,
  logger = { warn: vi.fn() },
): SmtpMailer {
  return new SmtpMailer({
    host: 'localhost',
    port: target.port,
    from: 'LinkVault <noreply@example.invalid>',
    secure: false,
    user: USER,
    password: PASSWORD,
    trustedCa: TEST_SMTP_CERT,
    logger,
  });
}

describe('SmtpMailer con credenciales', () => {
  it('SMTP con usuario y contraseña entrega el correo, autenticado sobre la conexión ya cifrada', async () => {
    server = await startTestSmtpServer({ users: { [USER]: PASSWORD } });
    await mailer(server).send(MESSAGE);
    expect(server.authAttempts).toEqual([{ username: USER, secure: true }]);
    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toMatchObject({
      to: ['ana@example.invalid'],
      user: USER,
      secure: true,
    });
  });

  it('las credenciales no viajan sin cifrar: sin STARTTLS el envío falla y el AUTH no llega', async () => {
    server = await startTestSmtpServer({
      users: { [USER]: PASSWORD },
      withoutStartTls: true,
    });
    await expect(mailer(server).send(MESSAGE)).rejects.toThrow();
    expect(server.authAttempts).toEqual([]);
    expect(server.received).toEqual([]);
  });

  it('las credenciales no van a un certificado sin verificar: sin la CA de pruebas el envío falla y el AUTH no llega', async () => {
    server = await startTestSmtpServer({ users: { [USER]: PASSWORD } });
    const untrusting = new SmtpMailer({
      host: 'localhost',
      port: server.port,
      from: 'LinkVault <noreply@example.invalid>',
      user: USER,
      password: PASSWORD,
      logger: { warn: vi.fn() },
    });
    await expect(untrusting.send(MESSAGE)).rejects.toThrow();
    expect(server.authAttempts).toEqual([]);
    expect(server.received).toEqual([]);
  });

  it.each([
    [
      'credenciales rechazadas',
      { rejectAuth: { code: 535, message: 'Authentication failed' } },
      'credentials_rejected',
      535,
    ],
    [
      'cuota agotada',
      {
        rejectRecipients: {
          code: 452,
          message: 'Daily sending limit exceeded',
        },
      },
      'quota_exceeded',
      452,
    ],
  ] as const)(
    'un rechazo por %s se registra con su clase y su código, sin credenciales',
    async (_label, options, cls, code) => {
      server = await startTestSmtpServer({
        users: { [USER]: PASSWORD },
        ...options,
      });
      const logger = { warn: vi.fn() };
      await expect(mailer(server, logger).send(MESSAGE)).rejects.toThrow();
      const logged = logger.warn.mock.calls
        .map((call) => call.map(String).join(' '))
        .join('\n');
      expect(logged).toContain(`class=${cls}`);
      expect(logged).toContain(`code=${code}`);
      expect(logged).not.toContain(USER);
      expect(logged).not.toContain(PASSWORD);
    },
  );
});

describe('SmtpMailer sin credenciales', () => {
  it('SMTP sin credenciales sigue funcionando como relay', async () => {
    // Un relay que autoriza por red (como Mailpit): entrega sin AUTH.
    server = await startTestSmtpServer({ authOptional: true });
    const relay = new SmtpMailer({
      host: 'localhost',
      port: server.port,
      from: 'LinkVault <noreply@example.invalid>',
    });
    await relay.send(MESSAGE);
    expect(server.authAttempts).toEqual([]);
    expect(server.received).toHaveLength(1);
    expect(server.received[0]?.user).toBeUndefined();
  });
});
