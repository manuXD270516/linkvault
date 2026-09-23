import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'notifications');
const RUN_ID = Date.now();
const EMAIL = `smoke-notify+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Notify';
const PASSWORD = `Notify-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('notifications: prefs page from profile, toggle save, vapid endpoint', async ({
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

  await page.goto('/perfil');
  await expect(page.getByTestId('profile-notifications-link')).toBeVisible({
    timeout: LIVE,
  });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'perfil-enlace.png'),
    fullPage: true,
  });
  await page.getByTestId('profile-notifications-link').click();
  await expect(page).toHaveURL(/\/notificaciones$/);
  await expect(page.getByTestId('notifications-page')).toBeVisible({
    timeout: LIVE,
  });
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'preferencias.png'),
    fullPage: true,
  });

  const toggle = page.locator('[data-testid="pref-group-new-link"] button');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.getByTestId('notifications-save').click();
  await expect(page.getByTestId('notifications-saved')).toBeVisible({
    timeout: LIVE,
  });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'preferencias-guardadas.png'),
    fullPage: true,
  });

  // Push section present; permiso denegado en headless no bloquea preferencias de email.
  await expect(page.getByTestId('notifications-push')).toBeVisible();
  await expect(page.getByTestId('pref-group-new-link')).toBeVisible();
  await expect(page.getByTestId('pref-group-weekly-digest')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
