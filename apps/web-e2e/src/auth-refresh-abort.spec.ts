import { type Route, expect, test } from '@playwright/test';
import { resetRegisterLimit } from './support/register-limit';

/**
 * Regresión de `session-refresh-abort` (tarea 3.1, design D8): una respuesta de rotación perdida no cuesta la sesión.
 *
 * El refresh de la restauración llega a la API (`route.fetch()` la hace rotar) y la respuesta se retiene tras una
 * compuerta que nunca se abre; la recarga siguiente aborta esa petición, así que el navegador no aplica el `Set-Cookie`
 * del sucesor y conserva el token viejo. Es el aborto de la guía de uso, sin depender de ella. Dentro de los 10 s de esa
 * rotación, la API reemite y la persona sigue en `/perfil`.
 *
 * Corre en `chromium` y en `mobile` (el hallazgo salió de un Pixel 7). Solo perfil `local`: crea una cuenta por
 * repetición y no lleva `@remote-safe`.
 */

const RUN_ID = Date.now();
const REFRESH_URL = '**/api/auth/refresh';
/** Espera de lo que depende de respuestas de la API: con la máquina cargada, 5 s son justos. */
const API_TIMEOUT = 15_000;
const REGISTER_TIMEOUT = 45_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test(
  'reload while the restore refresh is in flight keeps the session',
  { tag: ['@lot1'] },
  async ({ page }) => {
    test.setTimeout(120_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const visited: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        visited.push(frame.url());
      }
    });
    const logouts: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/auth/logout')) {
        logouts.push(request.url());
      }
    });

    await test.step('register and open the profile', async () => {
      await page.goto('/registro');
      await page.getByLabel('Nombre', { exact: true }).fill('Smoke Refresh Abort');
      await page.getByLabel('Email', { exact: true }).fill(`smoke-refresh-abort+${RUN_ID}@example.com`);
      await page.getByLabel('Contraseña', { exact: true }).fill(`Abort-pass-${RUN_ID}`);
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      // El primer alta de una pila fría con la CPU cargada llegó a tardar 15 s (Argon2).
      await expect(page).toHaveURL(/\/grupos$/, { timeout: REGISTER_TIMEOUT });
      await page.goto('/perfil');
      await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible({
        timeout: API_TIMEOUT,
      });
    });

    // La compuerta no se abre nunca: la respuesta retenida solo termina cuando el navegador aborta la petición.
    const gate = new Promise<void>(() => undefined);
    let rotated: () => void = () => undefined;
    const rotatedByApi = new Promise<void>((resolve) => {
      rotated = resolve;
    });
    const holdResponse = async (route: Route): Promise<void> => {
      const response = await route.fetch();
      rotated();
      await gate;
      await route.fulfill({ response });
    };

    await test.step('reload with the restore refresh held after the API rotated', async () => {
      await page.route(REFRESH_URL, holdResponse);
      await page.reload();
      await rotatedByApi;
      await page.unroute(REFRESH_URL, holdResponse);
    });

    await test.step('reload again: the aborted request never applied the new cookie', async () => {
      visited.length = 0;
      // Carga completa de `/perfil` y no `reload()`: con la API lenta bajo carga, la restauración de la página retenida
      // puede agotar sus 10 s y dejar la página en `/login`; la navegación aborta igual la petición retenida.
      await page.goto('/perfil');
      await expect(page).toHaveURL(/\/perfil$/, { timeout: API_TIMEOUT });
      await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible({
        timeout: API_TIMEOUT,
      });
    });

    expect(visited.filter((url) => url.includes('/login'))).toEqual([]);
    expect(logouts).toEqual([]);
    expect(pageErrors).toEqual([]);
  },
);
