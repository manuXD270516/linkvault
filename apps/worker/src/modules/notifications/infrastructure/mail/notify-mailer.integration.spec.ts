import {
  startTestSmtpServer,
  TEST_SMTP_CERT,
  type TestSmtpServer,
} from '@linkvault/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NotifyMailMessage } from '../../application/ports/notify.ports';
import { SmtpOrResendNotifyMailer } from './notify-mailer';

// Tarea 7.7 de `staging-host` (design D6; spec `platform/email`): el transporte SMTP de las notificaciones del `worker`
// contra el servidor en proceso de `@linkvault/testing`, con los mismos casos que el adaptador de `api` (7.5).

const USER = 'usuario-smtp-de-prueba';
const PASSWORD = 'clave-smtp-de-prueba';
const MESSAGE: NotifyMailMessage = {
  to: 'ana@example.invalid',
  templateId: 'group-new-link',
  locale: 'es',
  variables: {
    displayName: 'Ana',
    actionUrl: 'http://localhost:4200/grupos/x',
    groupName: 'Equipo',
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
  // `null` = sin CA de pruebas (un `undefined` aplicaría el valor por defecto).
  trustedCa: string | null = TEST_SMTP_CERT,
): SmtpOrResendNotifyMailer {
  return new SmtpOrResendNotifyMailer(
    'LinkVault <noreply@example.invalid>',
    'smtp',
    {
      host: 'localhost',
      port: target.port,
      secure: false,
      user: USER,
      password: PASSWORD,
      trustedCa: trustedCa ?? undefined,
    },
    undefined,
    logger,
  );
}

describe('notificaciones por SMTP con credenciales', () => {
  it('SMTP con usuario y contraseña entrega la notificación, autenticado sobre la conexión ya cifrada', async () => {
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

  it('sin STARTTLS el envío falla y el AUTH no llega', async () => {
    server = await startTestSmtpServer({
      users: { [USER]: PASSWORD },
      withoutStartTls: true,
    });
    await expect(mailer(server).send(MESSAGE)).rejects.toThrow();
    expect(server.authAttempts).toEqual([]);
    expect(server.received).toEqual([]);
  });

  it('con un certificado sin verificar el envío falla y el AUTH no llega', async () => {
    server = await startTestSmtpServer({ users: { [USER]: PASSWORD } });
    await expect(
      mailer(server, { warn: vi.fn() }, null).send(MESSAGE),
    ).rejects.toThrow();
    expect(server.authAttempts).toEqual([]);
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
