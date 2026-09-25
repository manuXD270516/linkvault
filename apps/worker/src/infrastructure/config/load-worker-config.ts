import {
  type AiConfig,
  type AiConfigProblem,
  formatAiConfigWarnings,
  parseAiConfig,
} from '@linkvault/ai';
import {
  MATCH_ANALYSIS_DEADLINE_MARGIN_MS,
  MATCH_ANALYSIS_DELIVERIES,
  assertAnalysisDeadlines,
} from '@linkvault/shared';
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
 *
 * Tras validar, comprueba que `MATCH_ANALYSIS_MAX_AGE_MS` sea mayor que `MATCH_ANALYSIS_TIMEOUT_MS` contando
 * entregas y margen (ADR-030 §7): una pareja invertida impide arrancar. Api y worker han de recibir el **mismo**
 * `MATCH_ANALYSIS_MAX_AGE_MS`.
 */
export function loadWorkerConfigOrExit(
  env: Readonly<Record<string, string | undefined>>,
): LoadedWorkerConfig {
  const worker = parseEnv(workerConfigSchema, env);
  const ai = parseAiConfig(env);
  if (worker.ok && ai.ok) {
    try {
      assertAnalysisDeadlines({
        maxAgeMs: worker.config.MATCH_ANALYSIS_MAX_AGE_MS,
        timeoutMs: worker.config.MATCH_ANALYSIS_TIMEOUT_MS,
        deliveries: MATCH_ANALYSIS_DELIVERIES,
        marginMs: MATCH_ANALYSIS_DEADLINE_MARGIN_MS,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        formatInvalidVariables('worker', [
          {
            name: 'MATCH_ANALYSIS_MAX_AGE_MS',
            reason: 'invalid',
            detail,
          },
        ]),
      );
      return process.exit(1);
    }
    // Avisos de IA: configuración válida que deja algo sin poder usarse (p. ej. el BYOK de OpenRouter sin modelo
    // utilizable, ADR-048 §6). Salen por stderr como los problemas —todavía no hay logger y `console` está
    // prohibido— pero **no** abortan: `ai/byok` exige que el proceso arranque igual.
    if (ai.warnings.length > 0) {
      process.stderr.write(formatAiConfigWarnings('worker', ai.warnings));
    }
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
