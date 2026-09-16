import type { Params } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import type { Options } from 'pino-http';
import type { ApiConfig } from '../config/api-config.schema';

const SENSITIVE_FIELDS = [
  'password',
  'apiKey',
  'accessToken',
  'refreshToken',
] as const;

/**
 * Rutas de redacción de pino (D11). pino no admite comodines recursivos y `*.apiKey` no casa con la raíz,
 * así que cada campo sensible se declara en la raíz, a un nivel y a dos niveles de anidación.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

/** Parámetros de `nestjs-pino`. `destination` solo se pasa en tests, para capturar la salida. */
export function buildLoggerParams(
  config: Pick<ApiConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: config.LOG_LEVEL,
    redact: { paths: [...LOG_REDACT_PATHS] },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
