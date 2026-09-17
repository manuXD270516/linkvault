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
  'res.headers["set-cookie"]',
  '*.headers.authorization',
  '*.headers.Authorization',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

/** Parámetros de `nestjs-pino`. `destination` solo se pasa en tests, para capturar la salida. */
export function buildLoggerParams(
  config: Pick<WorkerConfig, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Params {
  const options: Options = {
    level: config.LOG_LEVEL,
    redact: { paths: [...LOG_REDACT_PATHS] },
  };
  return { pinoHttp: destination ? [options, destination] : options };
}
