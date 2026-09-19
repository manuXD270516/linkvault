import { workspaceRoot } from '@nx/devkit';
import { type Page, expect, test } from '@playwright/test';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'applications-tracking');

const RUN_ID = Date.now();
/** Quien crea el grupo y guarda la oferta; es quien mira los avatares. */
const OWNER = {
  displayName: 'Smoke Dueña',
  email: `smoke-applications-owner+${RUN_ID}@example.com`,
  password: `Owner-pass-${RUN_ID}`,
};
/** Quien sigue la oferta: pulsa "Postulé", comparte, la mueve en el tablero y la deja de seguir. */
const TRACKER = {
  displayName: 'Smoke Postulante',
  email: `smoke-applications-tracker+${RUN_ID}@example.com`,
  password: `Tracker-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Postulaciones ${RUN_ID}`;

// Oferta de LinkedIn con un identificador propio de esta ejecución: el worker no descarga LinkedIn (su `robots.txt` lo
// prohíbe), así que la tarjeta se queda con la etiqueta de la URL, y ninguna ejecución hereda la vacante de otra.
const OFFER_URL = `https://www.linkedin.com/jobs/view/analista-de-datos-${RUN_ID}/`;
const OFFER_LABEL = `analista de datos ${RUN_ID}`;
const STAGE = 'Entrevista';

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string },
): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/** Fila de la lista de links del grupo con esa oferta. */
function offerRow(page: Page) {
  return page.locator('li').filter({ hasText: OFFER_LABEL });
}

/** Columna del tablero (`interest`, `applied`, `in_process`, `offer`, `accepted`, `closed`). */
function column(page: Page, id: string) {
  return page.locator(`[data-column="${id}"]`);
}

/** El diálogo que contiene ese componente: el panel y su confirmación pueden estar abiertos a la vez. */
function dialogWith(page: Page, selector: string) {
  return page.locator('mat-dialog-container').filter({ has: page.locator(selector) });
}

test('applications flow: track from the group, share, move on the board and untrack', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext();
  const trackerContext = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const owner = await ownerContext.newPage();
    const tracker = await trackerContext.newPage();
    for (const page of [owner, tracker]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    }
    let groupUrl = '';
    let inviteCode = '';

    await test.step('the owner creates a group and saves a job post', async () => {
      await owner.goto('/registro');
      await register(owner, OWNER);
      await expect(owner).toHaveURL(/\/grupos$/);

      await owner.getByRole('button', { name: 'Crear un grupo' }).click();
      const dialog = owner.getByRole('dialog');
      await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
      await dialog.getByRole('button', { name: 'Crear grupo' }).click();
      await expect(owner).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      groupUrl = owner.url();
      inviteCode = ((await owner.getByTestId('invite-code').textContent()) ?? '').trim();
      expect(inviteCode).not.toBe('');

      await owner.getByLabel('Pega el enlace de una oferta').fill(OFFER_URL);
      await owner.getByRole('button', { name: 'Guardar', exact: true }).click();
      await expect(offerRow(owner)).toHaveCount(1);
    });

    await test.step('a second member joins the group', async () => {
      await tracker.goto('/registro');
      await register(tracker, TRACKER);
      await expect(tracker).toHaveURL(/\/grupos$/);

      await tracker.goto(`/unirse?codigo=${inviteCode}`);
      await tracker.getByRole('dialog').getByRole('button', { name: 'Unirme' }).click();
      await expect(tracker).toHaveURL(groupUrl);
      await expect(tracker.getByRole('heading', { level: 1, name: GROUP_NAME })).toBeVisible();
    });

    await test.step('7.1 the member presses "Postulé", answers "Hoy" and sees the share invitation', async () => {
      const row = offerRow(tracker);
      // Guardar no es seguir: la oferta todavía ofrece los dos gestos.
      await expect(row.getByTestId('link-interested')).toBeVisible();
      await row.getByTestId('link-applied').click();

      const question = tracker.getByRole('dialog');
      await expect(question).toContainText('¿Cuándo postulaste?');
      await question.getByRole('button', { name: 'Hoy', exact: true }).click();

      await expect(row.getByTestId('link-own-status')).toHaveText(/Tu postulación:\s*Postulada/);
      const notice = tracker.getByTestId('share-notice');
      await expect(notice).toContainText(
        '¿Que tus grupos vean que postulaste a esta oferta? También quien entre después.',
      );
      await expect(notice.getByRole('button', { name: 'Qué verán' })).toBeVisible();
      await tracker.screenshot({ path: join(SCREENSHOT_DIR, 'postule-aviso.png'), fullPage: true });

      await notice.getByRole('button', { name: 'Compartir' }).click();
      const undo = tracker.getByTestId('share-notice-undo');
      await expect(tracker.getByTestId('share-notice')).toContainText('Compartido');
      // Con el foco dentro, "Compartido · Deshacer" no se cierra mientras la otra persona mira el grupo.
      await undo.focus();
    });

    await test.step('7.1 the other member sees the avatar with "Postulada"', async () => {
      await owner.goto(groupUrl);
      const avatar = offerRow(owner).getByTestId('tracker-avatar');
      await expect(avatar).toHaveCount(1);
      await expect(avatar).toHaveAttribute(
        'aria-label',
        `${TRACKER.displayName} · postulación: Postulada`,
      );
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'avatar-grupo.png'), fullPage: true });
    });

    await test.step('7.1 undoing the share hides the avatar', async () => {
      await tracker.getByTestId('share-notice-undo').click();
      await expect(offerRow(tracker).getByTestId('tracker-avatar')).toHaveCount(0);

      await owner.goto(groupUrl);
      await expect(offerRow(owner)).toHaveCount(1);
      await expect(offerRow(owner).getByTestId('tracker-avatar')).toHaveCount(0);
    });

    await test.step('7.1 the board shows it in "Postuladas" and moves it to "En proceso" with a stage', async () => {
      await tracker.getByRole('link', { name: 'Postulaciones' }).click();
      await expect(tracker).toHaveURL(/\/postulaciones$/);
      await expect(tracker.getByRole('heading', { level: 1, name: 'Postulaciones' })).toBeVisible();

      const card = column(tracker, 'applied').getByTestId('application-card');
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(OFFER_LABEL);
      await expect(card).toContainText('Postulaste hoy');
      await tracker.screenshot({ path: join(SCREENSHOT_DIR, 'tablero.png'), fullPage: true });

      // Vuelve a compartir desde el panel, con el interruptor: la marca aparece en la tarjeta del tablero.
      await card.getByTestId('application-open').click();
      const panel = dialogWith(tracker, 'lv-application-detail-dialog');
      await expect(panel.getByTestId('detail-share-scope')).toContainText(
        'Nunca la etapa, las notas ni el historial.',
      );
      await panel.getByRole('switch', { name: 'Compartir mi estado con mis grupos' }).click();
      await expect(card.getByTestId('application-shared')).toBeVisible();
      await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await expect(tracker.locator('mat-dialog-container')).toHaveCount(0);

      await card.getByTestId('application-move').click();
      await tracker.getByRole('menuitem', { name: 'En proceso' }).click();
      const stageDialog = dialogWith(tracker, 'lv-stage-dialog');
      // Ya tiene fecha: el diálogo solo pide la etapa.
      await expect(stageDialog).not.toContainText('¿Cuándo postulaste?');
      await stageDialog.getByTestId('stage-input').fill(STAGE);
      await stageDialog.getByRole('button', { name: 'Guardar', exact: true }).click();

      const moved = column(tracker, 'in_process').getByTestId('application-card');
      await expect(moved).toContainText(OFFER_LABEL);
      await expect(moved).toContainText(STAGE);
      await expect(column(tracker, 'applied').getByTestId('application-card')).toHaveCount(0);
    });

    await test.step('7.1 the other member sees "En proceso" and never the stage', async () => {
      await owner.goto(groupUrl);
      const avatar = offerRow(owner).getByTestId('tracker-avatar');
      await expect(avatar).toHaveCount(1);
      await expect(avatar).toHaveAttribute(
        'aria-label',
        `${TRACKER.displayName} · postulación: En proceso`,
      );
      await expect(owner.locator('body')).not.toContainText(STAGE);
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'avatar-en-proceso.png'), fullPage: true });
    });

    await test.step('7.2 untracking from the panel asks first, then removes the card', async () => {
      await column(tracker, 'in_process').getByTestId('application-open').click();
      const panel = dialogWith(tracker, 'lv-application-detail-dialog');
      await expect(panel.getByTestId('detail-status')).toHaveText(/En proceso\s*·\s*Entrevista/);
      await expect(panel.getByTestId('detail-history').getByRole('listitem')).toHaveCount(2);
      await tracker.screenshot({ path: join(SCREENSHOT_DIR, 'panel.png'), fullPage: true });

      await panel.getByTestId('detail-untrack').click();
      const confirmation = dialogWith(tracker, 'lv-confirm-dialog');
      await expect(confirmation).toContainText(
        'Dejarás de seguir esta oferta: se borrarán tu estado, tus notas y tu historial de esta oferta. Tus grupos dejarán de verte en ella. No se puede deshacer.',
      );
      await tracker.screenshot({ path: join(SCREENSHOT_DIR, 'dejar-de-seguir.png'), fullPage: true });
      await confirmation.getByRole('button', { name: 'Dejar de seguir' }).click();

      await expect(tracker.locator('mat-dialog-container')).toHaveCount(0);
      await expect(tracker.getByTestId('application-card')).toHaveCount(0);
      await expect(
        tracker.getByText('Aquí verás las ofertas que sigues.', { exact: false }),
      ).toBeVisible();
    });

    await test.step('7.2 the group card offers "Me interesa" and "Postulé" again', async () => {
      await tracker.goto(groupUrl);
      const row = offerRow(tracker);
      await expect(row.getByTestId('link-interested')).toBeVisible();
      await expect(row.getByTestId('link-applied')).toBeVisible();
      await expect(row.getByTestId('link-own-status')).toHaveCount(0);
    });

    await test.step('7.2 the other member no longer sees the avatar', async () => {
      await owner.goto(groupUrl);
      await expect(offerRow(owner)).toHaveCount(1);
      await expect(offerRow(owner).getByTestId('tracker-avatar')).toHaveCount(0);
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await trackerContext.close();
    await ownerContext.close();
  }
});
