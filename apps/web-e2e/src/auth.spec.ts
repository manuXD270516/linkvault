import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Page, type Response } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'auth-users');

const RUN_ID = Date.now();
const EMAIL = `smoke+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Tester';
const RENAMED = 'Smoke Renombrado';
const PASSWORD = `Initial-pass-${RUN_ID}`;
const NEW_PASSWORD = `Changed-pass-${RUN_ID}`;

function isAuthResponse(path: string): (response: Response) => boolean {
  return (response) =>
    response.url().endsWith(`/api/auth/${path}`) && response.request().method() === 'POST';
}

async function readAccessToken(response: Response): Promise<string> {
  const body: unknown = await response.json();
  if (
    typeof body === 'object' &&
    body !== null &&
    'accessToken' in body &&
    typeof body.accessToken === 'string'
  ) {
    return body.accessToken;
  }
  throw new Error(`Unexpected session response from ${response.url()}`);
}

async function fillLogin(page: Page, email: string, password: string): Promise<void> {
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
}

// El límite de registros por IP es de toda la suite: cada spec parte de cero para que un `429` de `auth` no
// haga fallar lo que este spec prueba (ver `support/register-limit.ts`).
test.beforeAll(() => {
  resetRegisterLimit();
});

test('auth flow: register, restore, profile, password change, logout and login', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const accessTokens: string[] = [];

  await test.step('register', async () => {
    await page.goto('/registro');
    await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
    await expect(page.getByText('Mínimo 10 caracteres')).toBeVisible();
    await expect(
      page.getByText('Usamos tu email para iniciar sesión y tu nombre para mostrarte en tus grupos.'),
    ).toBeVisible();

    await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
    await page.getByLabel('Email', { exact: true }).fill(EMAIL);
    await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'registro.png'), fullPage: true });

    const registerResponse = page.waitForResponse(isAuthResponse('register'));
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    const response = await registerResponse;
    expect(response.status()).toBe(201);
    accessTokens.push(await readAccessToken(response));

    await expect(page).toHaveURL(/\/grupos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
    await expect(page.getByText('Crea un grupo o únete con un código')).toBeVisible();
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'inicio.png'), fullPage: true });
  });

  await test.step('reload restores the session from the refresh cookie', async () => {
    const refreshResponse = page.waitForResponse(isAuthResponse('refresh'));
    await page.reload();
    const response = await refreshResponse;
    expect(response.status()).toBe(200);
    accessTokens.push(await readAccessToken(response));

    await expect(page).toHaveURL(/\/grupos$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
  });

  await test.step('access token is not persisted in web storage or IndexedDB', async () => {
    const storage = await page.evaluate(async () => {
      const dump = (store: Storage): string[] => {
        const entries: string[] = [];
        for (let index = 0; index < store.length; index++) {
          const key = store.key(index) ?? '';
          entries.push(`${key}=${store.getItem(key) ?? ''}`);
        }
        return entries;
      };
      const databases = await indexedDB.databases();
      return {
        local: dump(localStorage),
        session: dump(sessionStorage),
        databases: databases.map((database) => database.name ?? ''),
      };
    });

    for (const token of accessTokens) {
      for (const entry of [...storage.local, ...storage.session]) {
        expect(entry.includes(token)).toBe(false);
      }
    }
    expect(storage.databases).toEqual([]);
  });

  await test.step('update display name', async () => {
    await page.getByRole('link', { name: 'Perfil' }).click();
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
    await expect(page.getByTestId('profile-email')).toHaveValue(EMAIL);

    const nameInput = page.getByLabel('Nombre', { exact: true });
    await expect(nameInput).toHaveValue(DISPLAY_NAME);
    await nameInput.fill(RENAMED);
    await page.getByRole('button', { name: 'Guardar nombre' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Nombre guardado' })).toBeVisible();
  });

  await test.step('change password with a wrong current password', async () => {
    await page.getByLabel('Contraseña actual', { exact: true }).fill(`Wrong-pass-${RUN_ID}`);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'La contraseña actual no es correcta' }),
    ).toBeVisible();
  });

  await test.step('change password with the right current password', async () => {
    await page.getByLabel('Contraseña actual', { exact: true }).fill(PASSWORD);
    await page.getByLabel('Nueva contraseña', { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(
      page.getByRole('status').filter({
        hasText: 'Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.',
      }),
    ).toBeVisible();
    await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil.png'), fullPage: true });
  });

  await test.step('logout', async () => {
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/login(\?|$)/);
    await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  });

  await test.step('login with the new password honours returnUrl', async () => {
    await page.goto('/perfil');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fperfil$/);
    await fillLogin(page, EMAIL, NEW_PASSWORD);
    await expect(page).toHaveURL(/\/perfil$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Perfil' })).toBeVisible();
    await expect(page.getByLabel('Nombre', { exact: true })).toHaveValue(RENAMED);
  });

  await test.step('login with wrong credentials in a fresh context', async () => {
    const context = await browser.newContext();
    try {
      const freshPage = await context.newPage();
      await freshPage.goto('/login');
      await expect(
        freshPage.getByRole('heading', { level: 1, name: 'Iniciar sesión' }),
      ).toBeVisible();
      await fillLogin(freshPage, EMAIL, PASSWORD);
      await expect(
        freshPage.getByRole('alert').filter({ hasText: 'Email o contraseña incorrectos' }),
      ).toBeVisible();
      await expect(freshPage).toHaveURL(/\/login(\?|$)/);
      await freshPage.screenshot({
        path: join(SCREENSHOT_DIR, 'error-login.png'),
        fullPage: true,
      });
    } finally {
      await context.close();
    }
  });

  expect(pageErrors).toEqual([]);
});
