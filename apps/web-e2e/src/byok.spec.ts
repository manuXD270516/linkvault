import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'ai-byok');
const RUN_ID = Date.now();
const EMAIL = `smoke-byok+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Byok';
const PASSWORD = `Byok-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('BYOK profile: notices, save OpenAI hint, consent-off copy', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  await page.locator('mat-toolbar').getByRole('link', { name: 'Perfil' }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId('profile-byok')).toBeVisible({ timeout: LIVE });
  await expect(page.getByTestId('profile-byok-destination-openai')).toBeVisible();
  await expect(page.getByTestId('profile-byok-openrouter-data-collection')).toBeVisible();
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil-byok-vacio.png'), fullPage: true });

  const patchedConsent = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/users/me' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-ai-consent').locator('button').click();
  await patchedConsent;

  await page.getByTestId('profile-byok-key-openai').fill('sk-smoke-openai-key-123456');
  const putWait = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/api/users/me/ai-keys/openai' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-byok-save-openai').click();
  const put = await putWait;
  const body = (await put.json()) as { keyHint?: string; vendor?: string };
  expect(body.vendor).toBe('openai');
  expect(body.keyHint?.length).toBe(4);
  expect(JSON.stringify(body)).not.toContain('sk-smoke-openai-key-123456');
  await expect(page.getByTestId('profile-byok-hint-openai')).toContainText(body.keyHint!, {
    timeout: LIVE,
  });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil-byok-openai.png'), fullPage: true });

  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/users/me' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-ai-consent').locator('button').click();
  await revoked;
  await expect(page.getByTestId('profile-byok-consent-off')).toBeVisible({ timeout: LIVE });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'perfil-byok-consent-off.png'),
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
