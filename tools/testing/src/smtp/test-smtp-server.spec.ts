import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it } from 'vitest';
import {
  startTestSmtpServer,
  TEST_SMTP_CERT,
  type TestSmtpServer,
} from './test-smtp-server';

// Tarea 7.2 de `staging-host`: el servidor de pruebas exige AUTH tras STARTTLS.

let server: TestSmtpServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const message = {
  from: 'noreply@example.invalid',
  to: 'ana@example.invalid',
  subject: 'Prueba',
  text: 'Hola',
};

describe('startTestSmtpServer', () => {
  it('un cliente autenticado tras STARTTLS entrega el mensaje', async () => {
    server = await startTestSmtpServer({ users: { relay: 'secreto' } });
    const transport = nodemailer.createTransport({
      host: 'localhost',
      port: server.port,
      secure: false,
      requireTLS: true,
      auth: { user: 'relay', pass: 'secreto' },
      tls: { rejectUnauthorized: true, ca: TEST_SMTP_CERT },
    });
    await transport.sendMail(message);
    expect(server.authAttempts).toEqual([{ username: 'relay', secure: true }]);
    expect(server.received).toHaveLength(1);
    expect(server.received[0]).toMatchObject({
      to: ['ana@example.invalid'],
      user: 'relay',
      secure: true,
    });
  });

  it('un cliente que intenta AUTH sin STARTTLS es rechazado y el AUTH no llega al servidor', async () => {
    server = await startTestSmtpServer({ users: { relay: 'secreto' } });
    const transport = nodemailer.createTransport({
      host: 'localhost',
      port: server.port,
      secure: false,
      ignoreTLS: true,
      auth: { user: 'relay', pass: 'secreto' },
    });
    await expect(transport.sendMail(message)).rejects.toMatchObject({
      responseCode: 538,
    });
    expect(server.authAttempts).toEqual([]);
    expect(server.received).toEqual([]);
  });
});
