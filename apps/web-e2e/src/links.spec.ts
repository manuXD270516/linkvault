import { workspaceRoot } from '@nx/devkit';
import { type Page, expect, test } from '@playwright/test';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'job-links');

const RUN_ID = Date.now();
const USER = {
  displayName: 'Smoke Links',
  email: `smoke-links+${RUN_ID}@example.com`,
  password: `Links-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Links ${RUN_ID}`;

/** URL con slug: lo que se guarda (`displayUrl`) lo conserva, mientras que la normalizada se queda en el id. */
const LINKEDIN_URL =
  'https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-3912345678/?utm_source=smoke';
const LINKEDIN_LABEL = 'senior backend engineer at acme 3912345678';
const COMPUTRABAJO_URL =
  'https://bo.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-de-datos-en-acme-1a2b3c4d5e6f7890';
const COMPUTRABAJO_LABEL = 'oferta de trabajo de analista de datos en acme 1a2b3c4d5e6f7890';
/** Lo que alguien pega en el chat sin ser una oferta: se guarda igual y luego se quita. */
const VIDEO_URL = 'https://ejemplo.test/videos/video-de-gatos';
const VIDEO_LABEL = 'video de gatos';
const PRIVATE_URL =
  'https://www.getonbrd.com/jobs/programming/desarrollador-frontend-senior-acme-remote-ab12';
const PRIVATE_LABEL = 'desarrollador frontend senior acme remote ab12';

const CHAT = [
  `Ana: mirad esta oferta ${LINKEDIN_URL}`,
  `Beto: y esta otra ${COMPUTRABAJO_URL}`,
  `Ana: nada que ver, pero mirad ${VIDEO_URL}`,
].join('\n');

async function register(page: Page): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill(USER.displayName);
  await page.getByLabel('Email', { exact: true }).fill(USER.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(USER.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/** Fila de la lista de links cuya etiqueta es `label`. */
function linkRow(page: Page, label: string) {
  return page.locator('li').filter({ hasText: label });
}

async function saveLink(page: Page, url: string): Promise<void> {
  await page.getByLabel('Pega el enlace de una oferta').fill(url);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
}

test('links flow: save, open, import a chat, remove and the private list', async ({ browser }) => {
  test.setTimeout(180_000);
  const context = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let groupUrl = '';

    await test.step('the user registers and creates a group', async () => {
      await page.goto('/registro');
      await register(page);

      await expect(page).toHaveURL(/\/grupos$/);
      await page.getByRole('button', { name: 'Crear un grupo' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
      await dialog.getByRole('button', { name: 'Crear grupo' }).click();

      await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      groupUrl = page.url();
      await expect(
        page.getByText('Todavía no hay ofertas aquí. Guarda un link o pega el chat donde las compartís.'),
      ).toBeVisible();
    });

    await test.step('save a link in the group and see it in the list', async () => {
      await saveLink(page, LINKEDIN_URL);

      const row = linkRow(page, LINKEDIN_LABEL);
      await expect(row).toHaveCount(1);
      await expect(row).toContainText('LinkedIn');
      await expect(row).toContainText(`Compartido por ${USER.displayName}`);
      await expect(row).toContainText('Sin vista previa todavía');
      await expect(page.getByLabel('Pega el enlace de una oferta')).toHaveValue('');
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'link-guardado.png'), fullPage: true });
    });

    await test.step('the link opens in a new tab with the URL as it was written', async () => {
      const anchor = linkRow(page, LINKEDIN_LABEL).getByTestId('link-open');

      const href = (await anchor.getAttribute('href')) ?? '';
      // El slug solo está en `displayUrl`: la normalizada de LinkedIn se queda en `/jobs/view/<id>`.
      expect(href).toContain('senior-backend-engineer-at-acme');
      expect(href.startsWith('https://www.linkedin.com/jobs/view/')).toBe(true);
      await expect(anchor).toHaveAttribute('target', '_blank');
      await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
    });

    await test.step('paste a chat and see the summary and the new links', async () => {
      await page.getByRole('button', { name: 'Pegar un chat' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Texto del chat').fill(CHAT);
      await expect(dialog.getByTestId('import-counter')).toContainText(`${CHAT.length} /`);

      await dialog.getByRole('button', { name: 'Importar' }).click();

      // Dos nuevas (la oferta de Computrabajo y el vídeo) y la de LinkedIn, que ya estaba.
      await expect(dialog.getByTestId('import-summary')).toContainText('2 guardadas, 1 ya estaba');
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'resumen-importacion.png'),
        fullPage: true,
      });
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);

      await expect(linkRow(page, COMPUTRABAJO_LABEL)).toContainText('Computrabajo');
      // Lo que no es una oferta se guarda igual, con la plataforma sin reconocer.
      await expect(linkRow(page, VIDEO_LABEL)).toContainText('Otra web');
      await expect(page.getByTestId('link-open')).toHaveCount(3);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'lista-links.png'), fullPage: true });
    });

    await test.step('remove what was not a job post', async () => {
      await linkRow(page, VIDEO_LABEL).getByTestId('link-remove').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(
        'Se quita de este grupo; la oferta sigue disponible en otros grupos.',
      );
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'confirmar-quitar.png'), fullPage: true });

      await dialog.getByRole('button', { name: 'Quitar', exact: true }).click();

      await expect(linkRow(page, VIDEO_LABEL)).toHaveCount(0);
      await expect(page.getByTestId('link-open')).toHaveCount(2);
    });

    await test.step('the private list only holds what was saved without a group', async () => {
      await page.getByRole('link', { name: 'Solo para mí' }).click();

      await expect(page).toHaveURL(/\/mis-links$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Solo para mí' })).toBeVisible();
      await expect(
        page.getByText('Aquí guardas ofertas solo para ti. Las que compartiste están en tus grupos.'),
      ).toBeVisible();
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'mis-links-vacia.png'), fullPage: true });

      await saveLink(page, PRIVATE_URL);

      await expect(linkRow(page, PRIVATE_LABEL)).toContainText('Get on Board');
      // La lista privada no dice quién compartió: no hay con quién.
      await expect(linkRow(page, PRIVATE_LABEL)).not.toContainText('Compartido por');
      // Lo compartido en el grupo no entra en la lista privada.
      await expect(page.getByText(LINKEDIN_LABEL)).toHaveCount(0);
      await expect(page.getByTestId('link-open')).toHaveCount(1);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'mis-links.png'), fullPage: true });
    });

    await test.step('the group keeps its links after visiting the private list', async () => {
      await page.goto(groupUrl);

      await expect(linkRow(page, LINKEDIN_LABEL)).toHaveCount(1);
      await expect(linkRow(page, COMPUTRABAJO_LABEL)).toHaveCount(1);
      await expect(page.getByText(PRIVATE_LABEL)).toHaveCount(0);
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
