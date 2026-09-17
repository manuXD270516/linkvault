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
export default defineConfig({
  ...nxE2EPreset(import.meta.dirname, {
    testDir: './src',
    openHtmlReport: 'never',
  }),
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'pnpm nx serve web',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    cwd: workspaceRoot,
    env: { NX_DAEMON: 'false' },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
