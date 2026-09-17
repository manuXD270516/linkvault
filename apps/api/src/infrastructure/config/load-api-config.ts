import { apiConfigSchema, type ApiConfig } from './api-config.schema';
import { formatInvalidVariables, parseEnv } from './env-parser';

/**
 * Valida la configuración antes de crear la aplicación Nest (D8). Si falla, escribe por stderr los nombres
 * de las variables (todavía no hay logger y `console` está prohibido) y termina con código 1.
 */
export function loadApiConfigOrExit(
  env: Readonly<Record<string, string | undefined>>,
): ApiConfig {
  const result = parseEnv(apiConfigSchema, env);
  if (result.ok) {
    return result.config;
  }
  process.stderr.write(formatInvalidVariables('api', result.invalid));
  return process.exit(1);
}
