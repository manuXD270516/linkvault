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
import { apiConfigSchema, type ApiConfig } from './api-config.schema';
import {
  formatInvalidVariables,
  type InvalidVariable,
  parseEnv,
} from './env-parser';

/**
 * Configuración de `api`: la de la app y la de IA, validadas por separado. `api` ejecuta IA desde
 * paste-job-description (D1): lee el texto pegado dentro de la petición con la tarea `extract-pasted-job`.
 */
export interface LoadedApiConfig {
  readonly config: ApiConfig;
  readonly ai: AiConfig;
}

/**
 * Valida la configuración antes de crear la aplicación Nest (D8 de bootstrap-monorepo, D12 de ai-gateway-core, D1 de
 * paste-job-description). Ejecuta siempre el schema de `api` y el mismo `parseAiConfig` que el worker, para no
 * duplicar las reglas de IA y para informar de todos los problemas a la vez. Si algo falla, escribe por stderr una sola
 * línea con variables, motivo y detalle (todavía no hay logger y `console` está prohibido), nunca valores, y termina
 * con código 1.
 *
 * Tras validar, comprueba que `MATCH_ANALYSIS_MAX_AGE_MS` sea mayor que `MATCH_ANALYSIS_TIMEOUT_MS` contando
 * entregas y margen (ADR-030 §7): una pareja invertida impide arrancar.
 */
export function loadApiConfigOrExit(
  env: Readonly<Record<string, string | undefined>>,
): LoadedApiConfig {
  const api = parseEnv(apiConfigSchema, env);
  const ai = parseAiConfig(env);
  if (api.ok && ai.ok) {
    try {
      assertAnalysisDeadlines({
        maxAgeMs: api.config.MATCH_ANALYSIS_MAX_AGE_MS,
        timeoutMs: api.config.MATCH_ANALYSIS_TIMEOUT_MS,
        deliveries: MATCH_ANALYSIS_DELIVERIES,
        marginMs: MATCH_ANALYSIS_DEADLINE_MARGIN_MS,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        formatInvalidVariables('api', [
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
      process.stderr.write(formatAiConfigWarnings('api', ai.warnings));
    }
    return { config: api.config, ai: ai.config };
  }

  const aiInvalid = ai.ok ? [] : ai.problems.map(toInvalidVariable);
  const aiNames = new Set(aiInvalid.map((variable) => variable.name));
  // Si una variable falla en ambos parseos, prevalece el aviso de IA, que lleva el detalle.
  const apiInvalid = api.ok
    ? []
    : api.invalid.filter((variable) => !aiNames.has(variable.name));

  process.stderr.write(
    formatInvalidVariables('api', [...apiInvalid, ...aiInvalid]),
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
