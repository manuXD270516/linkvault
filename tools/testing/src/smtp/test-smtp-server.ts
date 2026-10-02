import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SMTPServer,
  type SMTPServerAuthentication,
  type SMTPServerSession,
} from 'smtp-server';

// Servidor SMTP **en proceso** para los tests del correo (tarea 7.2 de `staging-host`, design D6): sin Docker ni red.
// Exige `AUTH` **después** de `STARTTLS` (`allowInsecureAuth: false`, el valor por defecto de `smtp-server`: un `AUTH`
// sobre la conexión en claro recibe `538` y no llega a `onAuth`) con un certificado autofirmado para `localhost` y
// `127.0.0.1` que **solo confían los tests** (`cert`, que el cliente recibe como CA adicional). Sirve a `api` y a
// `worker`, que comprueban con él sus dos adaptadores SMTP.

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** Certificado de prueba (PEM) en el que confía el cliente del test. */
export const TEST_SMTP_CERT = readFileSync(
  `${FIXTURES}test-smtp.cert.pem`,
  'utf8',
);
const TEST_SMTP_KEY = readFileSync(`${FIXTURES}test-smtp.key.pem`, 'utf8');

export interface ReceivedMail {
  readonly from: string;
  readonly to: readonly string[];
  /** Usuario autenticado de la sesión, o `undefined` si se envió sin `AUTH`. */
  readonly user?: string;
  /** ¿Iba la conexión cifrada cuando se recibió el mensaje? */
  readonly secure: boolean;
  readonly data: string;
}

export interface AuthAttempt {
  readonly username: string;
  /** ¿Iba la conexión cifrada cuando llegó el `AUTH`? */
  readonly secure: boolean;
}

export interface TestSmtpRejection {
  readonly code: number;
  readonly message: string;
}

export interface TestSmtpServerOptions {
  /** Usuarios válidos (usuario → contraseña). */
  readonly users?: Readonly<Record<string, string>>;
  /** Rechaza todo `AUTH` con este código (p. ej. `535`), como un proveedor con la contraseña caducada. */
  readonly rejectAuth?: TestSmtpRejection;
  /** Rechaza los destinatarios con este código (p. ej. `452` por cupo), una vez autenticado. */
  readonly rejectRecipients?: TestSmtpRejection;
  /** Sin `STARTTLS` anunciado: un servidor que no ofrece cifrado. */
  readonly withoutStartTls?: boolean;
  /** Entrega también sin `AUTH`: un relay que autoriza por red (como Mailpit). Por defecto, AUTH obligatorio. */
  readonly authOptional?: boolean;
}

export interface TestSmtpServer {
  readonly host: string;
  readonly port: number;
  readonly received: ReceivedMail[];
  readonly authAttempts: AuthAttempt[];
  close(): Promise<void>;
}

function smtpError(rejection: TestSmtpRejection): Error {
  return Object.assign(new Error(rejection.message), {
    responseCode: rejection.code,
  });
}

export async function startTestSmtpServer(
  options: TestSmtpServerOptions = {},
): Promise<TestSmtpServer> {
  const received: ReceivedMail[] = [];
  const authAttempts: AuthAttempt[] = [];
  const users = options.users ?? {};
  const server = new SMTPServer({
    key: TEST_SMTP_KEY,
    cert: TEST_SMTP_CERT,
    secure: false,
    allowInsecureAuth: false,
    authOptional: options.authOptional === true,
    // `hideSTARTTLS` solo deja de anunciarlo: `requireTLS` del cliente lo intenta igual y el servidor lo aceptaría.
    // Un servidor «sin cifrado» tiene que rechazar el comando.
    hideSTARTTLS: options.withoutStartTls === true,
    disabledCommands: options.withoutStartTls === true ? ['STARTTLS'] : [],
    authMethods: ['PLAIN', 'LOGIN'],
    logger: false,
    onAuth(
      auth: SMTPServerAuthentication,
      session: SMTPServerSession,
      callback,
    ) {
      authAttempts.push({
        username: auth.username ?? '',
        secure: session.secure,
      });
      if (options.rejectAuth !== undefined) {
        callback(smtpError(options.rejectAuth));
        return;
      }
      if (
        auth.username !== undefined &&
        users[auth.username] !== undefined &&
        users[auth.username] === auth.password
      ) {
        callback(null, { user: auth.username });
        return;
      }
      callback(
        smtpError({ code: 535, message: 'Authentication credentials invalid' }),
      );
    },
    onRcptTo(_address, _session, callback) {
      if (options.rejectRecipients !== undefined) {
        callback(smtpError(options.rejectRecipients));
        return;
      }
      callback();
    },
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        received.push({
          from:
            session.envelope.mailFrom === false
              ? ''
              : session.envelope.mailFrom.address,
          to: session.envelope.rcptTo.map((rcpt) => rcpt.address),
          user: typeof session.user === 'string' ? session.user : undefined,
          secure: session.secure,
          data: Buffer.concat(chunks).toString('utf8'),
        });
        callback();
      });
    },
  });
  const host = '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => resolve());
  });
  const address = server.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('test SMTP server has no TCP address');
  }
  return {
    host,
    port: address.port,
    received,
    authAttempts,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
