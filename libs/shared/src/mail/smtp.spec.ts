import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  classifySmtpRejection,
  mailConfigShape,
  refineMailConfig,
  smtpTransportOptions,
} from './smtp';

// Tareas 7.1 y 7.3 de `staging-host` (design D6).

const schema = z
  .object(mailConfigShape)
  .superRefine((config, ctx) => refineMailConfig(config, ctx));
const smtpBase = {
  MAIL_PROVIDER: 'smtp',
  MAIL_FROM: 'LinkVault <noreply@example.invalid>',
  MAIL_SMTP_HOST: 'smtp-relay.example.invalid',
  MAIL_SMTP_PORT: '587',
};

function issuesFor(
  input: Record<string, string | undefined>,
): { path: string; message: string }[] {
  const result = schema.safeParse(input);
  return result.success
    ? []
    : result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
}

describe('mailConfigShape + refineMailConfig', () => {
  it('sin credenciales: válido (Mailpit, relay)', () => {
    expect(issuesFor(smtpBase)).toEqual([]);
  });

  it('con usuario y contraseña: válido', () => {
    expect(
      issuesFor({
        ...smtpBase,
        MAIL_SMTP_USER: 'apikey-user',
        MAIL_SMTP_PASSWORD: 'apikey-secret',
      }),
    ).toEqual([]);
  });

  it('usuario sin contraseña: falla nombrando MAIL_SMTP_PASSWORD, sin el valor del usuario', () => {
    const issues = issuesFor({
      ...smtpBase,
      MAIL_SMTP_USER: 'usuario-secreto',
    });
    expect(issues.map((issue) => issue.path)).toEqual(['MAIL_SMTP_PASSWORD']);
    expect(JSON.stringify(issues)).not.toContain('usuario-secreto');
  });

  it('contraseña sin usuario: falla nombrando MAIL_SMTP_USER, sin el valor de la contraseña', () => {
    const issues = issuesFor({
      ...smtpBase,
      MAIL_SMTP_PASSWORD: 'clave-secreta',
    });
    expect(issues.map((issue) => issue.path)).toEqual(['MAIL_SMTP_USER']);
    expect(JSON.stringify(issues)).not.toContain('clave-secreta');
  });

  it('MAIL_SMTP_SECURE: falso por defecto, verdadero con "true", inválido con otro valor', () => {
    expect(schema.parse(smtpBase).MAIL_SMTP_SECURE).toBe(false);
    expect(
      schema.parse({ ...smtpBase, MAIL_SMTP_SECURE: 'true' }).MAIL_SMTP_SECURE,
    ).toBe(true);
    expect(
      issuesFor({ ...smtpBase, MAIL_SMTP_SECURE: 'yes' }).map(
        (issue) => issue.path,
      ),
    ).toEqual(['MAIL_SMTP_SECURE']);
  });

  it('conserva las reglas de siempre: host y puerto con smtp, clave con resend', () => {
    expect(
      issuesFor({ MAIL_PROVIDER: 'smtp', MAIL_FROM: 'x' }).map(
        (issue) => issue.path,
      ),
    ).toEqual(['MAIL_SMTP_HOST', 'MAIL_SMTP_PORT']);
    expect(
      issuesFor({ MAIL_PROVIDER: 'resend', MAIL_FROM: 'x' }).map(
        (issue) => issue.path,
      ),
    ).toEqual(['RESEND_API_KEY']);
    expect(
      issuesFor({
        MAIL_PROVIDER: 'capture',
        MAIL_FROM: 'x',
        MAIL_SMTP_USER: 'solo',
      }),
    ).toEqual([]);
  });
});

describe('smtpTransportOptions: las cuatro combinaciones de credenciales y los dos modos de TLS', () => {
  const base = { host: 'smtp.example.invalid', port: 587 };

  it.each([
    ['ninguna', undefined, undefined],
    ['solo usuario', 'u', undefined],
    ['solo contraseña', undefined, 'p'],
  ])(
    'credenciales %s → sin autenticación, como hasta ahora (Mailpit)',
    (_label, user, password) => {
      for (const secure of [false, true]) {
        const options = smtpTransportOptions({
          ...base,
          secure,
          user,
          password,
        });
        expect(options).toEqual({
          ...base,
          secure,
          requireTLS: false,
          tls: { rejectUnauthorized: false },
        });
        expect(options.auth).toBeUndefined();
      }
    },
  );

  it('usuario y contraseña + STARTTLS (secure false): TLS exigido antes de AUTH y certificado verificado', () => {
    const options = smtpTransportOptions({
      ...base,
      secure: false,
      user: 'u',
      password: 'p',
    });
    expect(options).toEqual({
      ...base,
      secure: false,
      requireTLS: true,
      auth: { user: 'u', pass: 'p' },
      tls: { rejectUnauthorized: true },
    });
  });

  it('usuario y contraseña + TLS implícito (secure true): certificado verificado', () => {
    const options = smtpTransportOptions({
      ...base,
      port: 465,
      secure: true,
      user: 'u',
      password: 'p',
    });
    expect(options).toEqual({
      ...base,
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'u', pass: 'p' },
      tls: { rejectUnauthorized: true },
    });
  });

  it('una CA adicional se confía sin desactivar la verificación', () => {
    const options = smtpTransportOptions({
      ...base,
      secure: false,
      user: 'u',
      password: 'p',
      trustedCa: 'PEM',
    });
    expect(options.tls).toEqual({ rejectUnauthorized: true, ca: 'PEM' });
  });
});

describe('classifySmtpRejection: un caso por código de la tabla de design D6', () => {
  it.each([530, 534, 535])('%i → credenciales rechazadas', (code) => {
    expect(
      classifySmtpRejection({
        responseCode: code,
        response: `${code} Authentication failed`,
      }),
    ).toEqual({
      class: 'credentials_rejected',
      code,
    });
  });

  it.each([421, 450, 451, 452, 550, 551, 552, 553, 554])(
    '%i con texto de límite → cuota agotada',
    (code) => {
      expect(
        classifySmtpRejection({
          responseCode: code,
          response: `${code} Daily sending limit exceeded`,
        }),
      ).toEqual({
        class: 'quota_exceeded',
        code,
      });
    },
  );

  it.each([421, 450, 451, 452, 550, 551, 552, 553, 554])(
    '%i sin texto de límite → sin clasificar',
    (code) => {
      expect(
        classifySmtpRejection({
          responseCode: code,
          response: `${code} Mailbox unavailable`,
        }),
      ).toEqual({
        class: 'unclassified',
        code,
      });
    },
  );

  it('otros códigos y errores sin código → sin clasificar', () => {
    expect(
      classifySmtpRejection({
        responseCode: 501,
        response: '501 Syntax error',
      }),
    ).toEqual({ class: 'unclassified', code: 501 });
    expect(classifySmtpRejection(new Error('connect ECONNREFUSED'))).toEqual({
      class: 'unclassified',
    });
    expect(classifySmtpRejection(undefined)).toEqual({ class: 'unclassified' });
  });
});
