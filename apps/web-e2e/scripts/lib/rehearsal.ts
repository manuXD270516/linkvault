import type { MatchExpectation } from './args';

// Entorno del `worker` del ensayo remoto (change `e2e-suite`, design D3 fase 5 y D7; tarea 4.5).
//
// Antes del ensayo, el runner reinicia **solo** `worker` con un proveedor de IA externo **configurado pero
// inalcanzable**: la cuenta del ensayo no tiene permiso de IA externa, así que el análisis degrada por falta de permiso
// sin llamar a nadie; si hubiera cualquier llamada, iría a un dominio reservado (`.invalid`), que no resuelve, y el
// motivo del análisis sería un error del proveedor, no `consent_required`.

/**
 * Clave **falsa** de OpenRouter: `parseOpenRouter` exige que exista, no que valga. No es un secreto ni puede serlo: el
 * origen es `https://ai.invalid`, que no resuelve.
 */
export const REHEARSAL_FAKE_OPENROUTER_KEY = 'e2e-rehearsal-fake-openrouter-key-not-a-secret';

/** Lo que el `worker` del ensayo recibe encima del entorno de la suite (design D3 fase 5). */
export const REHEARSAL_WORKER_OVERRIDES: Readonly<Record<string, string>> = {
  AI_CHAIN: 'openrouter',
  OPENROUTER_API_KEY: REHEARSAL_FAKE_OPENROUTER_KEY,
  // `parseOpenRouter` exige un modelo `:free` cuando `AI_CHAIN` incluye `openrouter`; vale el de los tests.
  OPENROUTER_MODEL: 'cohere/north-mini-code:free',
  OPENROUTER_BASE_URL: 'https://ai.invalid',
  NODE_ENV: 'development',
};

/** El entorno de la suite con las variables del ensayo encima; no quita ninguna otra. */
export function rehearsalWorkerEnv(suiteEnv: Readonly<Record<string, string>>): Record<string, string> {
  return { ...suiteEnv, ...REHEARSAL_WORKER_OVERRIDES };
}

/**
 * Descripción de la cadena del `worker` del ensayo para `worker.log` y `runner.log`: todas las variables del ensayo
 * **salvo la clave**, que no se escribe aunque sea falsa (CLAUDE.md: nunca loguear claves).
 */
export function describeRehearsalWorker(): string {
  return Object.entries(REHEARSAL_WORKER_OVERRIDES)
    .map(([key, value]) => (key === 'OPENROUTER_API_KEY' ? `${key}=<clave falsa, no se muestra>` : `${key}=${value}`))
    .join(', ');
}

/**
 * PID de escucha de un puerto antes y después del reinicio (tarea 4.5): el conjunto de PID que atienden el puerto de
 * `api` tiene que ser el mismo, y no vacío. Devuelve el problema o `null`.
 */
export function compareListenerPids(
  label: string,
  before: readonly number[],
  after: readonly number[],
): string | null {
  const a = [...new Set(before)].sort((x, y) => x - y);
  const b = [...new Set(after)].sort((x, y) => x - y);
  if (a.length === 0) {
    return `${label}: no listener PID before the worker restart`;
  }
  if (a.length !== b.length || a.some((pid, index) => pid !== b[index])) {
    return `${label}: listener PIDs changed across the worker restart (before ${a.join(',')}, after ${b.join(',') || 'none'})`;
  }
  return null;
}

/**
 * Expectativa del paso 7 en el ensayo (design D7; decisión del usuario del 2026-09-27, tarea 5.7): la de
 * `--match-expectation` si se pasó, como en `e2e-remote`; si no, `consent-required`, el desenlace del destino que el
 * ensayo imita (cuenta sin permiso de IA externa y un proveedor externo inalcanzable).
 */
export function rehearsalMatchExpectation(flag: MatchExpectation | undefined): MatchExpectation {
  return flag ?? 'consent-required';
}
