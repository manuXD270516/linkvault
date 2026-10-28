import { z } from 'zod';

// Configuración y rechazos del correo SMTP, **una vez** para `api` y `worker` (design D6 de `staging-host`, spec
// `platform/email` «Adaptadores Resend, SMTP/Mailpit y captura»). Sin `nodemailer`: lo que sale de aquí son datos que
// cada adaptador pasa a su transporte. Hasta este change cada esquema tenía su copia del `superRefine` de correo y
// ninguna sabía de credenciales; dos procesos que validan distinto dejan la mitad de los correos sin entregar.

const port = z.coerce.number().int().min(1).max(65_535);

/** Variables de correo que validan `api` y `worker` (se esparcen en su `z.object`). */
export const mailConfigShape = {
  // `smtp` → Mailpit local o un servidor con credenciales; `resend` → API HTTP (exige clave); `capture` → tests/CI.
  MAIL_PROVIDER: z.enum(['smtp', 'resend', 'capture']),
  MAIL_FROM: z.string().min(1),
  MAIL_SMTP_HOST: z.string().min(1).optional(),
  MAIL_SMTP_PORT: port.optional(),
  // Las dos juntas o ninguna (ver `refineMailConfig`). Sin ninguna, el envío es sin autenticación (Mailpit, relay).
  MAIL_SMTP_USER: z.string().min(1).optional(),
  MAIL_SMTP_PASSWORD: z.string().min(1).optional(),
  // `true` = TLS implícito (típico del 465); `false` = conexión en claro que, con credenciales, exige STARTTLS.
  MAIL_SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  // Vacío en local; obligatorio solo con `MAIL_PROVIDER=resend`.
  RESEND_API_KEY: z.string().optional(),
};

/** Lo que `refineMailConfig` lee de la configuración ya parseada. */
export interface MailConfigFields {
  readonly MAIL_PROVIDER: 'smtp' | 'resend' | 'capture';
  readonly MAIL_SMTP_HOST?: string;
  readonly MAIL_SMTP_PORT?: number;
  readonly MAIL_SMTP_USER?: string;
  readonly MAIL_SMTP_PASSWORD?: string;
  readonly RESEND_API_KEY?: string;
}

/**
 * Las reglas condicionales del correo, para el `superRefine` de los dos esquemas. Cada issue lleva en `path` la
 * variable y un mensaje **fijo**: nunca el valor recibido (el usuario SMTP tampoco es algo que deba salir en un log).
 */
export function refineMailConfig(
  config: MailConfigFields,
  ctx: z.RefinementCtx,
): void {
  const missing = (name: string, message: string): void => {
    ctx.addIssue({ code: 'custom', path: [name], message });
  };
  if (
    config.MAIL_PROVIDER === 'resend' &&
    (config.RESEND_API_KEY ?? '') === ''
  ) {
    missing(
      'RESEND_API_KEY',
      'RESEND_API_KEY is required when MAIL_PROVIDER=resend',
    );
  }
  if (config.MAIL_PROVIDER !== 'smtp') {
    return;
  }
  if ((config.MAIL_SMTP_HOST ?? '') === '') {
    missing(
      'MAIL_SMTP_HOST',
      'MAIL_SMTP_HOST is required when MAIL_PROVIDER=smtp',
    );
  }
  if (config.MAIL_SMTP_PORT === undefined) {
    missing(
      'MAIL_SMTP_PORT',
      'MAIL_SMTP_PORT is required when MAIL_PROVIDER=smtp',
    );
  }
  // Juntas o ninguna: la que falta impide arrancar, en vez de descubrirse al enviar el primer correo.
  const hasUser = (config.MAIL_SMTP_USER ?? '') !== '';
  const hasPassword = (config.MAIL_SMTP_PASSWORD ?? '') !== '';
  if (hasUser && !hasPassword) {
    missing(
      'MAIL_SMTP_PASSWORD',
      'MAIL_SMTP_PASSWORD is required when MAIL_SMTP_USER is set',
    );
  }
  if (hasPassword && !hasUser) {
    missing(
      'MAIL_SMTP_USER',
      'MAIL_SMTP_USER is required when MAIL_SMTP_PASSWORD is set',
    );
  }
}

/** Opciones de transporte SMTP, con la forma que acepta `nodemailer.createTransport`. */
export interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  /** TLS desde el primer byte (TLS implícito). */
  readonly secure: boolean;
  /** Con `secure: false`: negociar STARTTLS es obligatorio y, si el servidor no lo ofrece, el envío falla. */
  readonly requireTLS: boolean;
  readonly auth?: { readonly user: string; readonly pass: string };
  readonly tls: { readonly rejectUnauthorized: boolean; readonly ca?: string };
}

export interface SmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly user?: string;
  readonly password?: string;
  /** Certificado de una CA adicional en la que confiar (p. ej. la de pruebas); el resto, las del sistema. */
  readonly trustedCa?: string;
}

/**
 * Traduce la configuración a opciones de transporte. **Con credenciales**, la conexión va cifrada antes de enviarlas
 * (TLS implícito o STARTTLS exigido) y el certificado del servidor se verifica siempre: enviar la contraseña en claro
 * o a un certificado sin comprobar no ocurre ni como degradación silenciosa, el envío falla. **Sin credenciales** se
 * conserva el comportamiento de siempre, el de Mailpit: sin TLS exigido y sin verificar el certificado.
 */
export function smtpTransportOptions(
  settings: SmtpSettings,
): SmtpTransportOptions {
  const hasCredentials =
    (settings.user ?? '') !== '' && (settings.password ?? '') !== '';
  if (!hasCredentials) {
    return {
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      requireTLS: false,
      tls: { rejectUnauthorized: false },
    };
  }
  return {
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    requireTLS: !settings.secure,
    auth: { user: settings.user ?? '', pass: settings.password ?? '' },
    tls: {
      rejectUnauthorized: true,
      ...(settings.trustedCa === undefined ? {} : { ca: settings.trustedCa }),
    },
  };
}

/** Clase de un rechazo del servidor SMTP (design D6). */
export const SMTP_REJECTION_CLASSES = [
  'credentials_rejected',
  'quota_exceeded',
  'unclassified',
] as const;
export type SmtpRejectionClass = (typeof SMTP_REJECTION_CLASSES)[number];

export interface SmtpRejection {
  readonly class: SmtpRejectionClass;
  /** Código de respuesta del servidor, si lo hubo (un fallo de conexión o de TLS no lo tiene). */
  readonly code?: number;
}

const CREDENTIAL_CODES = new Set([530, 534, 535]);
const QUOTA_CODES = new Set([421, 450, 451, 452, 550, 551, 552, 553, 554]);
const QUOTA_TEXT = /limit|quota|exceed|too many|rate/i;

/**
 * Clasifica el error de un envío por su código de respuesta SMTP: `530`/`534`/`535` → credenciales rechazadas;
 * `421`/`450`/`451`/`452`/`550`-`554` **con texto de límite** → cuota agotada; el resto → sin clasificar. Con un
 * proveedor de cupo diario, «la cuota se agotó» y «la contraseña caducó» piden reacciones distintas. Lee `responseCode`
 * y `response`, los campos que `nodemailer` pone en sus errores; el texto solo se usa para clasificar, no se devuelve.
 */
export function classifySmtpRejection(error: unknown): SmtpRejection {
  const record =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof record['responseCode'] === 'number'
      ? record['responseCode']
      : undefined;
  const response =
    typeof record['response'] === 'string' ? record['response'] : '';
  if (code === undefined) {
    return { class: 'unclassified' };
  }
  if (CREDENTIAL_CODES.has(code)) {
    return { class: 'credentials_rejected', code };
  }
  if (QUOTA_CODES.has(code) && QUOTA_TEXT.test(response)) {
    return { class: 'quota_exceeded', code };
  }
  return { class: 'unclassified', code };
}
