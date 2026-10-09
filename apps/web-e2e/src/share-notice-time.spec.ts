import { type Page, expect, test } from '@playwright/test';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';

/**
 * Evidencia INFORMATIVA de `usage-guide-fixes` (tareas 6.1 y 6.2, design D8): sin `@lot1`, así que no cuenta como
 * verificación de ninguna tarea (`apps/web-e2e/README.md`, «El camino antiguo»). Se ejecuta a mano contra una pila
 * levantada con `--keep-stack`:
 *
 *   E2E_BASE_URL=http://localhost:4300 pnpm exec playwright test -c apps/web-e2e/playwright.config.mts \
 *     share-notice-time --project=chromium
 *
 * 6.1: con el reloj del navegador simulado, ¿el aviso de compartir se cierra a los 10 s si el foco no está en él?
 * 6.2: ¿se cierra al navegar a otra página?
 */

const RUN_ID = Date.now();
const JOB_ID = jobIdBase(JOB_ID_SLOTS.applications) + 5;
const USER = {
  displayName: 'Smoke Aviso',
  email: `smoke-share-notice+${RUN_ID}@example.com`,
  password: `Notice-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Aviso ${RUN_ID}`;

const offer = (n: number): { url: string; label: string } => ({
  url: `https://www.linkedin.com/jobs/view/analista-de-datos-${JOB_ID + n}/`,
  label: `analista de datos ${JOB_ID + n}`,
});

function row(page: Page, label: string) {
  return page.locator('li').filter({ hasText: label });
}

async function saveOffer(page: Page, n: number): Promise<void> {
  await page.getByLabel('Pega el enlace de una oferta').fill(offer(n).url);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(row(page, offer(n).label)).toHaveCount(1, { timeout: 15_000 });
}

test('the share notice follows the group page and closes after 10 s without focus', async ({ page }) => {
  test.setTimeout(180_000);
  await page.clock.install();
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(USER.displayName);
  await page.getByLabel('Email', { exact: true }).fill(USER.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/);

  await page.getByRole('button', { name: 'Crear un grupo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
  await dialog.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
  for (const n of [0, 1, 2]) {
    await saveOffer(page, n);
  }

  await test.step('6.1 the invite closes after 10 s when the focus is outside', async () => {
    await row(page, offer(0).label).getByTestId('link-interested').click();
    const notice = page.getByTestId('share-notice');
    await expect(notice).toContainText('¿Que tus grupos vean que te interesa esta oferta?');
    await page.clock.fastForward(9_000);
    await expect(notice).toBeVisible();
    await page.clock.fastForward(2_000);
    await expect(notice).toBeHidden({ timeout: 10_000 });
  });

  await test.step('6.1 the shared notice closes after 10 s when the focus is outside', async () => {
    await row(page, offer(1).label).getByTestId('link-interested').click();
    const notice = page.getByTestId('share-notice');
    await notice.getByRole('button', { name: 'Compartir' }).click();
    await expect(notice).toContainText('Compartido');
    await page.clock.fastForward(11_000);
    await expect(notice).toBeHidden({ timeout: 10_000 });
  });

  await test.step('6.2 the shared notice does not follow to another page', async () => {
    await row(page, offer(2).label).getByTestId('link-interested').click();
    const notice = page.getByTestId('share-notice');
    await notice.getByRole('button', { name: 'Compartir' }).click();
    await expect(notice).toContainText('Compartido');
    await page.getByRole('link', { name: 'Postulaciones' }).click();
    await expect(page).toHaveURL(/\/postulaciones$/);
    await expect(page.getByTestId('share-notice')).toHaveCount(0);
  });
});
