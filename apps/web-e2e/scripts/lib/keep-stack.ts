/**
 * Mensaje final de `--keep-stack` (design D3; decisión del usuario del 2026-09-27). Medido en Windows: lanzado por
 * `pnpm nx run web-e2e:e2e-stack`, cuando la corrida **falla** (el target sale con ≠0) Nx termina `api`, `worker` y
 * `web` después de que el runner salga, y solo queda la infraestructura; lanzado con `node` directamente, las tres
 * sobreviven. El runner no puede impedirlo desde dentro, así que no promete lo que no se va a cumplir: en ese caso lo
 * dice y da la orden directa.
 */
export interface KeepStackContext {
  readonly failed: boolean;
  readonly platform: NodeJS.Platform;
  /** El runner lo lanzó una tarea de Nx (`NX_TASK_TARGET_PROJECT` en su entorno). */
  readonly underNx: boolean;
  readonly projectName: string;
  readonly downCommand: string;
  /** Argumentos con los que se lanzó el runner, para repetir la corrida sin Nx. */
  readonly runnerArgs: readonly string[];
}

export const DIRECT_RUNNER =
  'node --import tsx apps/web-e2e/scripts/e2e-stack.ts (desde la raíz, con TSX_TSCONFIG_PATH=apps/web-e2e/scripts/tsconfig.json)';

export function keepStackMessage(context: KeepStackContext): string {
  const down = `Para apagarla: ${context.downCommand}`;
  if (context.failed && context.platform === 'win32' && context.underNx) {
    const args = context.runnerArgs.join(' ');
    return (
      `--keep-stack: la infraestructura del proyecto ${context.projectName} sigue levantada, pero api, worker y web NO: ` +
      'la corrida falló y, lanzado por Nx en Windows, Nx las termina cuando el runner sale con ≠0. ' +
      `Para conservar la pila entera tras un fallo, lanza el runner sin Nx: ${DIRECT_RUNNER} ${args}. ${down}`
    );
  }
  return `--keep-stack: la pila sigue levantada (proyecto ${context.projectName}). ${down}`;
}
