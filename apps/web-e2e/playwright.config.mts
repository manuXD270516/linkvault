import { workspaceRoot } from '@nx/devkit';
import { nxE2EPreset } from '@nx/playwright/preset';
import { defineConfig, devices } from '@playwright/test';

// Smoke de UI de `web`. Reutiliza el `nx serve web` que ya esté en marcha; si no hay ninguno, lo arranca.
// El preset de Nx deja resultados e informe HTML en dist/.playwright/apps/web-e2e (fuera de apps/).
//
// `webServer.env` fija NX_DAEMON=false porque Playwright lanza el comando con la salida por pipe, y en Windows
// nx con daemon se cuelga así. Además, un webServer con `env` hace que @nx/playwright/plugin no infiera una
// dependencia continua sobre `web:serve`: esa dependencia arrancaría otro dev-server y fallaría con el puerto
// 4200 ocupado cuando ya hay uno en marcha. El arranque o la reutilización quedan en manos de Playwright.
//
// Con `E2E_BASE_URL` (la fija el runner `web-e2e:e2e-stack`, design D4) no hay `webServer`: la pila la monta y la
// apaga el runner, y Playwright no reutiliza ni arranca ningún servidor. Sin ella, el camino antiguo de arriba.
const runnerBaseUrl = process.env['E2E_BASE_URL'];

// Determinismo (design D12). Local: sin reintentos. CI: un reintento que **clasifica** (fallo estable frente a
// intermitente) y deja la traza de los dos intentos, y `failOnFlakyTests` convierte en rojo la prueba que solo pasa al
// reintentarse. `workers: 1` en los dos: las pruebas comparten el contador de registros por IP y el `worker` de la pila.
const inCi = Boolean(process.env['CI']);

// Con `--rehearse-remote`, el runner lanza Playwright dos veces en la misma corrida (perfil `local` y ensayo `remote`),
// y cada lanzamiento vacía su carpeta de resultados y reescribe su informe: el perfil `remote` escribe los suyos al lado,
// con el sufijo `-remote`, para que la corrida conserve el diagnóstico de los dos (design D12).
const preset = nxE2EPreset(import.meta.dirname, {
  testDir: './src',
  openHtmlReport: 'never',
});
const remoteProfile = process.env['E2E_PROFILE'] === 'remote';
const profileDir = (dir: string): string => (remoteProfile ? `${dir}-remote` : dir);

type ReporterEntry = [string, Record<string, unknown>];
function isReporterEntry(entry: unknown): entry is ReporterEntry {
  return Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'object' && entry[1] !== null;
}
/** Las carpetas del informe HTML (`outputFolder`) y del blob (`outputDir`) de cada reporter del preset, por perfil. */
function withProfileDirs(options: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...options };
  for (const key of ['outputFolder', 'outputDir']) {
    const value = options[key];
    if (typeof value === 'string') {
      result[key] = profileDir(value);
    }
  }
  return result;
}

export default defineConfig({
  ...preset,
  outputDir: profileDir(preset.outputDir),
  reporter: preset.reporter.filter(isReporterEntry).map(([name, options]): ReporterEntry => [name, withProfileDirs(options)]),
  workers: 1,
  retries: inCi ? 1 : 0,
  failOnFlakyTests: inCi,
  use: {
    baseURL: runnerBaseUrl ?? 'http://localhost:4200',
    // Traza y vídeo de cada fallo, también del primer intento (con `on-first-retry` y cero reintentos no habría nunca).
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  ...(runnerBaseUrl === undefined
    ? {
        webServer: {
          command: 'pnpm nx serve web',
          url: 'http://localhost:4200',
          reuseExistingServer: true,
          cwd: workspaceRoot,
          env: { NX_DAEMON: 'false' },
        },
      }
    : {}),
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // Las personas invitadas usan el móvil (design D11): el camino crítico se ejecuta también en un Pixel 7 emulado
    // (Chromium), y solo él; los demás specs siguen solo en escritorio.
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'] },
      testMatch: 'critical-path.spec.ts',
    },
  ],
});
