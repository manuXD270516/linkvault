import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Response } from '@playwright/test';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(
  workspaceRoot,
  'reports',
  'smoke',
  'bootstrap-monorepo',
);
const APP_ORIGIN = 'http://localhost:4200';

test('home placeholder renders in Spanish without errors', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const scriptUrls: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('response', (response: Response) => {
    const url = response.url();
    if (!url.startsWith(APP_ORIGIN)) {
      return;
    }
    if (response.status() >= 400) {
      failedResponses.push(`${response.status()} ${url}`);
    }
    if (response.request().resourceType() === 'script') {
      scriptUrls.push(url);
    }
  });

  await page.goto('/');

  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('LinkVault');
  await expect(
    page.getByText('La aplicación está en construcción.'),
  ).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle('LinkVault');

  // La página llega por loadComponent: su contenido vive dentro de <lv-home-page>, que el router inserta
  // después de <router-outlet>, y el navegador ha pedido un chunk JS además del de entrada.
  await expect(
    page.locator('lv-root router-outlet + lv-home-page h1'),
  ).toHaveText('LinkVault');
  const lazyChunks = scriptUrls.filter((url) =>
    /\/chunk-[A-Z0-9]+\.js(\?|$)/.test(url),
  );
  expect(lazyChunks.length).toBeGreaterThan(0);

  expect(consoleErrors).toEqual([]);
  expect(failedResponses).toEqual([]);

  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'home.png'),
    fullPage: true,
  });
});
