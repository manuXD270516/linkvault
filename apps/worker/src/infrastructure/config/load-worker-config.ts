import {
  type AiConfig,
  type AiConfigProblem,
  parseAiConfig,
} from '@linkvault/ai';
import {
  formatInvalidVariables,
  type InvalidVariable,
  parseEnv,
} from './env-parser';
import { type WorkerConfig, workerConfigSchema } from './worker-config.schema';

/** Configuración del worker: la de la app y la de IA, validadas por separado y listas para `AiModule`. */
export interface LoadedWorkerConfig {
  readonly config: WorkerConfig;
  readonly ai: AiConfig;
}

/**
 * Valida la configuración antes de crear la aplicación Nest (D8 de bootstrap-monorepo, D12 de ai-gateway-core).
 * Ejecuta siempre el schema del worker y `parseAiConfig` para informar de todos los problemas a la vez. Si algo
 * falla, escribe por stderr una sola línea con variables, motivo y detalle (todavía no hay logger y `console` está
 * prohibido), nunca valores, y termina con código 1.
 */
export function loadWorkerConfigOrExit(
  env: Readonly<Record<string, string | undefined>>,
): LoadedWorkerConfig {
  const worker = parseEnv(workerConfigSchema, env);
  const ai = parseAiConfig(env);
  if (worker.ok && ai.ok) {
    return { config: worker.config, ai: ai.config };
  }

  const aiInvalid = ai.ok ? [] : ai.problems.map(toInvalidVariable);
  const aiNames = new Set(aiInvalid.map((variable) => variable.name));
  // Si una variable falla en ambos parseos, prevalece el aviso de IA, que lleva el detalle.
  const workerInvalid = worker.ok
    ? []
    : worker.invalid.filter((variable) => !aiNames.has(variable.name));

  process.stderr.write(
    formatInvalidVariables('worker', [...workerInvalid, ...aiInvalid]),
  );
  return process.exit(1);
}

function toInvalidVariable(problem: AiConfigProblem): InvalidVariable {
  return {
    name: problem.variable,
    reason: problem.problem,
    ...(problem.detail === undefined ? {} : { detail: problem.detail }),
  };
}
