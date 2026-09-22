import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'auth-email-recovery');
const RUN_ID = Date.now();
const EMAIL = `smoke-email+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Email';
const PASSWORD = `Email-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('auth-email-recovery: banner, forgot page, verify flow', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/login');
  await expect(page.getByRole('link', { name: /olvidé|forgot/i })).toBeVisible({
    timeout: LIVE,
  });
  await page.getByRole('link', { name: /olvidé|forgot/i }).click();
  await expect(page).toHaveURL(/\/recuperar-contrasena$/);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'recuperar.png'), fullPage: true });

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });
  await expect(page.getByTestId('email-unverified-banner')).toBeVisible({ timeout: LIVE });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'banner.png'), fullPage: true });

  await page.getByTestId('email-unverified-banner').getByRole('button').click();
  await expect(
    page.getByTestId('email-unverified-banner').getByText(/enviado|sent|procede/i),
  ).toBeVisible({ timeout: LIVE });

  expect(pageErrors).toEqual([]);
});
