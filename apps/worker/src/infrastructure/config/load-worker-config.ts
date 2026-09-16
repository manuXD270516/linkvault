import { formatInvalidVariables, parseEnv } from './env-parser';
import { type WorkerConfig, workerConfigSchema } from './worker-config.schema';

/**
 * Valida la configuración antes de crear la aplicación Nest (D8). Si falla, escribe por stderr los nombres
 * de las variables (todavía no hay logger y `console` está prohibido) y termina con código 1.
 */
export function loadWorkerConfigOrExit(
  env: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  const result = parseEnv(workerConfigSchema, env);
  if (result.ok) {
    return result.config;
  }
  process.stderr.write(formatInvalidVariables('worker', result.invalid));
  return process.exit(1);
}
