import { NullResultCache } from '../../application/null-result-cache';
import { RunTask } from '../../application/run-task.usecase';
import { TaskRegistry, type AnyAiTask } from '../../application/task-registry';
import type { AiLogger } from '../../domain/ports/ai-logger.port';
import type { Clock } from '../../domain/ports/clock.port';
import type {
  AiConfig,
  AiConfigProblem,
  AiProviderId,
} from '../../infrastructure/config/ai-config.schema';
import {
  parseAiConfig,
  type AiEnv,
} from '../../infrastructure/config/parse-ai-config';
import { FilePromptRegistry } from '../../infrastructure/prompt-registry/file-prompt-registry';
import { buildProviders } from '../../infrastructure/providers/provider-registry';
import {
  AllowAllQuotaPolicy,
  EvalUsageLedger,
  NullCircuitBreaker,
  StderrAiLogger,
} from './eval-ports';

// Composición de `RunTask` para evaluar y grabar (D3 de ai-eval-harness, ADR-019 §6). Función pura respecto al proceso:
// recibe el entorno en lugar de leer `process.env` o `.env`, y devuelve un error en lugar de terminar el proceso.

export interface ComposeEvalRunTaskOptions {
  /** Entorno de partida (el CLI pasa `process.env`). No se lee ningún `.env`. */
  env: AiEnv;
  /** Único proveedor de la cadena. El mock va siempre en `replay`. */
  provider: AiProviderId;
  /** Permiso explícito para proveedores con `capabilities.external` (`--allow-external`). */
  allowExternal: boolean;
  /** `--ollama-url`: sustituye a `OLLAMA_URL`. */
  ollamaUrl?: string;
  /** `--timeout-ms`: sustituye a `OLLAMA_TIMEOUT_MS`. */
  ollamaTimeoutMs?: number;
  /** Tareas para el registro de `buildProviders`. */
  tasks: readonly AnyAiTask[];
  /** Base de rutas relativas de prompts y fixtures; por defecto la de `parseAiConfig` (`process.cwd()`). */
  cwd?: string;
  clock?: Clock;
  logger?: AiLogger;
}

export interface EvalRunTaskComposition {
  runTask: RunTask;
  config: AiConfig;
  ledger: EvalUsageLedger;
  clock: Clock;
  logger: AiLogger;
}

export type ComposeEvalRunTaskError =
  | { kind: 'invalid_config'; problems: readonly AiConfigProblem[] }
  | { kind: 'external_not_allowed'; providerId: string };

export type ComposeEvalRunTaskResult =
  | { ok: true; value: EvalRunTaskComposition }
  | { ok: false; error: ComposeEvalRunTaskError };

const systemClock: Clock = { now: () => Date.now() };

/** Entorno efectivo de D3: el recibido con `NODE_ENV`, `AI_CHAIN`, `AI_MOCK_MODE` y los flags de Ollama fijados. */
export function evalEnv(options: ComposeEvalRunTaskOptions): AiEnv {
  const { env, provider, ollamaUrl, ollamaTimeoutMs } = options;
  const nodeEnv = env['NODE_ENV'];
  return {
    ...env,
    NODE_ENV: nodeEnv === undefined || nodeEnv === '' ? 'development' : nodeEnv,
    AI_CHAIN: provider,
    ...(provider === 'mock' ? { AI_MOCK_MODE: 'replay' } : {}),
    ...(ollamaUrl === undefined ? {} : { OLLAMA_URL: ollamaUrl }),
    ...(ollamaTimeoutMs === undefined
      ? {}
      : { OLLAMA_TIMEOUT_MS: String(ollamaTimeoutMs) }),
  };
}

export function composeEvalRunTask(
  options: ComposeEvalRunTaskOptions,
): ComposeEvalRunTaskResult {
  const parsed = parseAiConfig(
    evalEnv(options),
    options.cwd === undefined ? {} : { cwd: options.cwd },
  );
  if (!parsed.ok) {
    return {
      ok: false,
      error: { kind: 'invalid_config', problems: parsed.problems },
    };
  }
  const { config } = parsed;

  // Construir proveedores no contacta a ninguno: se comprueba el permiso antes de devolver nada ejecutable.
  const built = buildProviders(config, {
    tasks: new TaskRegistry(options.tasks),
  });
  const external = built.providers.find(
    (provider) => provider.capabilities.external,
  );
  if (external !== undefined && !options.allowExternal) {
    return {
      ok: false,
      error: { kind: 'external_not_allowed', providerId: external.id },
    };
  }

  const clock = options.clock ?? systemClock;
  const logger = options.logger ?? new StderrAiLogger();
  const ledger = new EvalUsageLedger();
  const runTask = new RunTask({
    providers: built.providers,
    providerTimeoutsMs: built.timeoutsMs,
    prompts: new FilePromptRegistry({ promptsDir: config.promptsDir }),
    cache: new NullResultCache(),
    ledger,
    quota: new AllowAllQuotaPolicy(),
    breaker: new NullCircuitBreaker(),
    clock,
    logger,
  });
  return { ok: true, value: { runTask, config, ledger, clock, logger } };
}
