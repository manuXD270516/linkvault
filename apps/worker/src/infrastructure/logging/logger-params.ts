import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import type { WorkerConfig } from '../config/worker-config.schema';

const SENSITIVE_FIELDS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'apiKey',
  'accessToken',
  'refreshToken',
] as const;

/**
 * Rutas de redacción de pino (D11). pino no admite comodines recursivos y `*.apiKey` no casa con la raíz,
 * así que cada campo sensible se declara en la raíz, a un nivel y a dos niveles de anidación. La cabecera
 * `authorization` de cualquier objeto `headers` anidado un nivel (p. ej. una petición saliente a un proveedor de IA)
 * se redacta en minúsculas y con mayúscula inicial (D12 de ai-gateway-core).
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.referer',
  'res.headers["set-cookie"]',
  '*.headers.authorization',
  '*.headers.Authorization',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

const REDACTED = '[Redacted]';
const REFERER_PATH = ['req', 'headers', 'referer'] as const;

/**
 * El `referer` se reduce a origen más ruta: su query string puede llevar un código de invitación
 * (`/unirse?codigo=…`, `returnUrl`). Si no es una URL http(s) absoluta se corta en el primer `?` o `#`.
 */
export function stripReferer(value: unknown): unknown {
  if (typeof value !== 'string') return REDACTED;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return `${url.origin}${url.pathname}`;
    }
  } catch {
    // No es una URL absoluta: se corta a mano.
  }
  return value.split(/[?#]/, 1)[0];
}

/**
 * Cualquier ruta redactada vale `[Redacted]`, salvo el `referer`, que conserva origen y ruta. Se compara segmento a
 * segmento: en las rutas con comodín pino pasa un `Symbol` en `path`, y `path.join` lanzaría.
 */
export function censorLogValue(value: unknown, path: readonly unknown[]): unknown {
  const isReferer =
    path.length === REFERER_PATH.length &&
    REFERER_PATH.every((segment, index) => path[index] === segment);
  return isReferer ? stripReferer(value) : REDACTED;
}

/** Parámetros de `nestjs-pino`. `destination` solo se pasa en tests, para capturar la salida. */
export function buildLoggerParams(
  config: Pick<WorkerConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: config.LOG_LEVEL,
    redact: { paths: [...LOG_REDACT_PATHS], censor: censorLogValue },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
