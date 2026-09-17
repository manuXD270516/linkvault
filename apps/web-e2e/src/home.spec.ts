import { expect, test, type ConsoleMessage, type Response } from '@playwright/test';

const APP_ORIGIN = 'http://localhost:4200';
const REFRESH_URL = `${APP_ORIGIN}/api/auth/refresh`;

/** Sin cookie, el arranque intenta restaurar la sesión y la API responde 401: es el único fallo esperado. */
function isExpectedRefresh401(status: number, method: string, url: string): boolean {
  return status === 401 && method === 'POST' && url === REFRESH_URL;
}

test('root without session ends on /login in Spanish without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  let refresh401Seen = false;

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') {
      return;
    }
    // Chrome registra en consola cada respuesta >= 400; se ignora solo la del refresh de arranque.
    if (message.location().url === REFRESH_URL && message.text().includes('401')) {
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response: Response) => {
    const url = response.url();
    if (!url.startsWith(APP_ORIGIN) || response.status() < 400) {
      return;
    }
    if (isExpectedRefresh401(response.status(), response.request().method(), url)) {
      refresh401Seen = true;
      return;
    }
    failedResponses.push(`${response.status()} ${response.request().method()} ${url}`);
  });

  await page.goto('/');

  await expect(page).toHaveURL(/\/login(\?|$)/);
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle('LinkVault');

  expect(refresh401Seen).toBe(true);
  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);
});
