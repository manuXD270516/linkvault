import { describe, expect, it } from 'vitest';
import { CapturingMailer } from './capturing-mailer';
import { expiresInHuman, renderMail } from './mail-templates';
import type { Mailer, MailMessage } from './mailer.port';
import { ResendMailer } from './resend-mailer';
import { SmtpMailer } from './smtp-mailer';

const SAMPLE: MailMessage = {
  to: 'ana@example.com',
  templateId: 'email-verification',
  locale: 'en',
  variables: {
    displayName: 'Ana',
    actionUrl: 'http://localhost:4200/verificar-email?token=opaque-token',
    expiresInHuman: '24 hours',
  },
};

describe('Mailer port contract', () => {
  it('Auth no importa el SDK del proveedor (mock de contrato)', async () => {
    const sent: MailMessage[] = [];
    const mailer: Mailer = {
      send: (message) => {
        sent.push(message);
        return Promise.resolve();
      },
    };

    await mailer.send(SAMPLE);

    expect(sent).toEqual([SAMPLE]);
  });
});

describe('CapturingMailer', () => {
  it('Captura en test y CI', async () => {
    const mailer = new CapturingMailer();

    await mailer.send({
      ...SAMPLE,
      templateId: 'password-reset',
      locale: 'es',
      variables: {
        displayName: 'Ana',
        actionUrl: 'http://localhost:4200/restablecer-contrasena?token=abc',
        expiresInHuman: '1 hora',
      },
    });

    const captured = mailer.lastTo('Ana@example.com');
    expect(captured?.to).toBe('ana@example.com');
    expect(captured?.templateId).toBe('password-reset');
    expect(captured?.locale).toBe('es');
    expect(captured?.variables.actionUrl).toContain('token=abc');
    expect(mailer.messages).toHaveLength(1);
  });
});

describe('mail templates (plain text)', () => {
  it('Correo de verificación en inglés usa WEB_BASE_URL en actionUrl', () => {
    const rendered = renderMail('email-verification', 'en', SAMPLE.variables);

    expect(rendered.subject).toMatch(/Verify/i);
    expect(rendered.text).toContain('Confirm your email');
    expect(rendered.text).toContain(SAMPLE.variables.actionUrl);
    expect(rendered.text).not.toMatch(/<html|<body|<a /i);
  });

  it('plantilla de reset en español es texto plano', () => {
    const rendered = renderMail('password-reset', 'es', {
      displayName: 'Ana',
      actionUrl: 'http://localhost:4200/restablecer-contrasena?token=x',
      expiresInHuman: '1 hora',
    });

    expect(rendered.subject).toMatch(/contraseña/i);
    expect(rendered.text).toContain('restablecer');
    expect(rendered.text).not.toMatch(/<html/i);
  });

  it('expiresInHuman formatea horas y minutos', () => {
    expect(expiresInHuman('es', 3600)).toBe('1 hora');
    expect(expiresInHuman('en', 86_400)).toBe('24 hours');
    expect(expiresInHuman('es', 900)).toBe('15 minutos');
  });
});

describe('SmtpMailer', () => {
  it('se construye con host y puerto del env', () => {
    const mailer = new SmtpMailer({
      host: 'localhost',
      port: 1025,
      from: 'LinkVault <noreply@example.com>',
    });
    expect(mailer).toBeInstanceOf(SmtpMailer);
  });
});

describe('ResendMailer', () => {
  it('envía asunto y cuerpo plano con From y sin loguear la clave', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const mailer = new ResendMailer({
      apiKey: 're_test_secret_key_do_not_log',
      from: 'LinkVault <noreply@example.com>',
      fetchImpl: ((url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return Promise.resolve(new Response('{}', { status: 200 }));
      }) as typeof fetch,
    });

    await mailer.send(SAMPLE);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.resend.com/emails');
    const body = JSON.parse(String(calls[0]?.init.body)) as {
      from: string;
      to: string[];
      subject: string;
      text: string;
      html?: string;
    };
    expect(body.from).toBe('LinkVault <noreply@example.com>');
    expect(body.to).toEqual(['ana@example.com']);
    expect(body.subject).toMatch(/Verify/i);
    expect(body.text).toContain(SAMPLE.variables.actionUrl);
    expect(body.html).toBeUndefined();
    const auth = (calls[0]?.init.headers as Record<string, string>)[
      'Authorization'
    ];
    expect(auth).toBe('Bearer re_test_secret_key_do_not_log');
  });

  it('propaga error de API sin incluir la clave en el mensaje', async () => {
    const mailer = new ResendMailer({
      apiKey: 're_test_secret_key_do_not_log',
      from: 'LinkVault <noreply@example.com>',
      fetchImpl: (() =>
        Promise.resolve(new Response('nope', { status: 401 }))) as typeof fetch,
    });

    await expect(mailer.send(SAMPLE)).rejects.toThrow(/401/);
    await expect(mailer.send(SAMPLE)).rejects.not.toThrow(
      /re_test_secret_key_do_not_log/,
    );
  });
});
