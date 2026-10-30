import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';
import { armCapabilitiesResponse, readShellCapabilities } from './support/shell-nav';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'search');
const RUN_ID = Date.now();
const EMAIL = `smoke-search+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Search';
const PASSWORD = `Search-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('search: /buscar hybrid page, empty query, no mode, GET /api/search; or the not-included notice', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const searchRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/search' && request.method() === 'GET') {
      searchRequests.push(request.url());
    }
  });

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  // Con la búsqueda apagada (como en `e2e.env` y en staging) la barra no ofrece «Buscar»: se llega por enlace directo.
  // La espera de las capacidades se arma antes del `goto`, que recarga el SPA y vuelve a crear el Shell.
  const capabilities = armCapabilitiesResponse(page);
  await page.goto('/buscar');
  await expect(page).toHaveURL(/\/buscar$/, { timeout: LIVE });
  const declared = await readShellCapabilities(page, capabilities);
  await expect(page.getByTestId('search-page')).toBeVisible({ timeout: LIVE });
  if (!declared.search) {
    await expect(page.getByTestId('search-not-enabled')).toContainText('La búsqueda no está incluida en esta versión de LinkVault.');
    await expect(page.getByTestId('search-page').getByRole('link', { name: 'Ver Solo para mí' })).toHaveAttribute(
      'href',
      '/mis-links',
    );
    await expect(page.getByTestId('search-query')).toHaveCount(0);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'buscar-no-incluida.png'),
      fullPage: true,
    });
    expect(searchRequests, 'no GET /api/search while search is off').toEqual([]);
    expect(pageErrors).toEqual([]);
    return;
  }

  await expect(page.getByTestId('search-page')).toBeVisible({ timeout: LIVE });
  await expect(page.getByRole('heading', { level: 1, name: 'Buscar' })).toBeVisible();
  await expect(page.getByTestId('search-doc-type')).toBeVisible();
  await expect(page.getByTestId('search-group')).toBeVisible();
  await expect(page.getByTestId('search-modality')).toBeVisible();
  await expect(page.getByTestId('search-application-status')).toBeVisible();
  await expect(page.getByTestId('search-salary-currency')).toBeVisible();
  await expect(page.getByTestId('search-open-only')).toBeVisible();
  await expect(page.getByTestId('search-mode')).toHaveCount(0);
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'buscar-vacio.png'),
    fullPage: true,
  });

  await page.getByTestId('search-submit').click();
  await expect(page.getByTestId('search-empty-query')).toBeVisible({
    timeout: LIVE,
  });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'buscar-empty-query.png'),
    fullPage: true,
  });

  await page.getByTestId('search-query').fill('Nest remoto TypeScript');
  const searchResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/search') &&
      response.request().method() === 'GET',
  );
  await page.getByTestId('search-submit').click();
  const response = await searchResponse;
  expect([200, 503]).toContain(response.status());
  expect(response.url()).not.toMatch(/[?&]mode=/);

  if (response.status() === 200) {
    await expect(
      page.getByTestId('search-results').or(page.getByTestId('search-empty')),
    ).toBeVisible({ timeout: LIVE });
  } else {
    await expect(page.getByTestId('search-unavailable')).toBeVisible({
      timeout: LIVE,
    });
  }

  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'buscar-resultados.png'),
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
