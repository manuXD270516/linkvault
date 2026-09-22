import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import type { ApiConfig } from '../config/api-config.schema';

const SENSITIVE_FIELDS = [
  'password',
  'currentPassword',
  'newPassword',
  'passwordHash',
  'apiKey',
  'accessToken',
  'refreshToken',
  'AI_VAULT_KEY',
  'ciphertext',
  'vaultKey',
  'token',
  'RESEND_API_KEY',
  'actionUrl',
  'text',
] as const;

/**
 * Rutas de redacción de pino (D11). pino no admite comodines recursivos y `*.apiKey` no casa con la raíz,
 * así que cada campo sensible se declara en la raíz, a un nivel y a dos niveles de anidación.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers.referer',
  'res.headers["set-cookie"]',
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

/**
 * Rutas públicas cuyo log automático de petición se apaga (D4 de public-preview-share): la página `/p/:slug` y las
 * lecturas sin sesión de `/api/public/`. De ellas se registra **solo** `{ slug, status }`, que escribe su controlador;
 * la línea automática de `pino-http` lleva además la dirección de origen, el `User-Agent` y el referente de quien
 * visita, y la spec dice que de una página pública no se guarda ningún dato de quien la abre.
 *
 * Se apaga por ruta y no por completo: del resto de la API, ese log es la única traza de cada petición.
 */
export function isPublicRouteLog(url: string | undefined): boolean {
  const path = (url ?? '').split(/[?#]/, 1)[0] ?? '';
  return (
    path === '/p' || path.startsWith('/p/') || path.startsWith('/api/public/')
  );
}

/**
 * La ruta que hay que mirar es `originalUrl`, no `url`: el middleware va montado por ruta, así que para cuando llega
 * aquí `url` es lo que queda **después** del punto de montaje (`/`) y no dice nada. `originalUrl` es la que pidió el
 * cliente.
 */
export function isPublicRouteRequest(request: {
  url?: string | undefined;
}): boolean {
  const original = (request as { originalUrl?: unknown }).originalUrl;
  return isPublicRouteLog(
    typeof original === 'string' ? original : request.url,
  );
}

/** Parámetros de `nestjs-pino`. `destination` solo se pasa en tests, para capturar la salida. */
export function buildLoggerParams(
  config: Pick<ApiConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: config.LOG_LEVEL,
    redact: { paths: [...LOG_REDACT_PATHS], censor: censorLogValue },
    autoLogging: { ignore: isPublicRouteRequest },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
