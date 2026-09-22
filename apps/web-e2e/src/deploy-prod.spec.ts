import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'deploy-prod');
const RUN_ID = Date.now();
const EMAIL = `smoke-deploy+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Deploy';
const PASSWORD = `Deploy-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('deploy-prod: /privacidad public + perfil danger zone delete', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/privacidad');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: LIVE });
  await expect(page.getByText(/CV|cifrado|retención|OpenRouter|borrar/i).first()).toBeVisible({
    timeout: LIVE,
  });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'privacidad.png'), fullPage: true });

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  await page.locator('mat-toolbar').getByRole('link', { name: 'Perfil' }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId('profile-privacy-link')).toBeVisible({ timeout: LIVE });
  await expect(page.getByTestId('profile-danger')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil-danger.png'), fullPage: true });

  await page.getByTestId('profile-danger').getByRole('button').click();
  await page.getByTestId('profile-delete-password').fill(PASSWORD);
  const deleted = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname === '/api/users/me' &&
      response.status() === 204,
    { timeout: LIVE },
  );
  await page.getByTestId('profile-delete-confirm').click();
  await deleted;
  await expect(page).toHaveURL(/\/login$/, { timeout: LIVE });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'post-delete-login.png'), fullPage: true });

  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByText(/incorrect|inválid|credencial/i).first()).toBeVisible({
    timeout: LIVE,
  });

  expect(pageErrors).toEqual([]);
});
