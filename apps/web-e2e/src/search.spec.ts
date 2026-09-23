import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'search');
const RUN_ID = Date.now();
const EMAIL = `smoke-search+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Search';
const PASSWORD = `Search-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('search: /buscar hybrid page, empty query, no mode, GET /api/search', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  await page.getByRole('link', { name: /Buscar/i }).click();
  await expect(page).toHaveURL(/\/buscar$/, { timeout: LIVE });
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
