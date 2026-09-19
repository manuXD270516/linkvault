import { workspaceRoot } from '@nx/devkit';
import { type Page, expect, test } from '@playwright/test';
import { join } from 'node:path';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'group-comments');

const RUN_ID = Date.now();
/** Id de oferta de este spec: único aunque otro spec arranque en el mismo milisegundo. */
const JOB_ID = jobIdBase(JOB_ID_SLOTS.comments);
/** Propietaria del grupo: comparte la oferta con nota y modera los comentarios. */
const OWNER = {
  displayName: 'Smoke Ana',
  email: `smoke-comments-owner+${RUN_ID}@example.com`,
  password: `Owner-pass-${RUN_ID}`,
};
/** Miembro: ve la nota, comenta y al final sale del grupo. */
const MEMBER = {
  displayName: 'Smoke Beto',
  email: `smoke-comments-member+${RUN_ID}@example.com`,
  password: `Member-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Comentarios ${RUN_ID}`;

// Oferta de LinkedIn con un identificador propio de esta ejecución: el worker no descarga LinkedIn (su `robots.txt` lo
// prohíbe), así que la tarjeta se queda con la etiqueta de la URL, y ninguna ejecución hereda la vacante de otra.
const OFFER_URL = `https://www.linkedin.com/jobs/view/backend-developer-${JOB_ID}/`;
const OFFER_LABEL = `backend developer ${JOB_ID}`;
const NOTE = 'Esta es la que te dije';
const FIRST_COMMENT = `Piden inglés C1 ${RUN_ID}`;
const SECOND_COMMENT = `Ya cerró ${RUN_ID}`;

/** Espera de las comprobaciones que dependen de datos en vivo (canal de eventos) o de la lista recién pedida. */
const LIVE_TIMEOUT = 15_000;

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string },
): Promise<void> {
  // El límite de registros por IP (10 cada 15 min) es de toda la suite y los specs corren a la vez desde la misma
  // máquina: se vacía justo antes de cada alta para que un 429 de `auth` no haga fallar lo que se prueba aquí. El
  // límite en sí lo prueban los tests de `api` (ver `support/register-limit.ts`).
  resetRegisterLimit();
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/** Fila de la lista de links del grupo con esa oferta. */
function offerRow(page: Page) {
  return page.locator('li').filter({ hasText: OFFER_LABEL });
}

/** El diálogo que contiene ese componente: el hilo y su confirmación pueden estar abiertos a la vez. */
function dialogWith(page: Page, selector: string) {
  return page.locator('mat-dialog-container').filter({ has: page.locator(selector) });
}

function thread(page: Page) {
  return dialogWith(page, 'lv-comments-dialog');
}

/** Comentario del hilo abierto con ese texto. */
function threadComment(page: Page, text: string) {
  return thread(page).getByTestId('thread-comment').filter({ hasText: text });
}

/** Comentario de la tarjeta con ese texto. */
function cardComment(page: Page, text: string) {
  return offerRow(page).getByTestId('link-comment').filter({ hasText: text });
}

/**
 * Abre el detalle del grupo y espera a la primera página de sus links y a que se abra el canal de eventos. Sin lo
 * primero, una comprobación de ausencia pasaría en vacío; sin lo segundo, un aviso en vivo podría llegar antes de que
 * la pantalla escuche.
 */
async function openGroup(page: Page, groupUrl: string): Promise<void> {
  const groupId = new URL(groupUrl).pathname.split('/').at(-1) ?? '';
  const links = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/groups/${groupId}/links` &&
      response.ok(),
    { timeout: LIVE_TIMEOUT },
  );
  const events = page.waitForRequest(
    (request) => request.method() === 'GET' && new URL(request.url()).pathname === '/api/events',
    { timeout: LIVE_TIMEOUT },
  );
  await page.goto(groupUrl);
  await Promise.all([links, events]);
}

/** Abre el hilo desde la tarjeta y espera a su primera página. */
async function openThread(page: Page): Promise<void> {
  const page1 = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/api\/groups\/[^/]+\/links\/[^/]+\/comments$/.test(new URL(response.url()).pathname) &&
      response.ok(),
    { timeout: LIVE_TIMEOUT },
  );
  await offerRow(page).getByTestId('link-comments-open').click();
  await page1;
  await expect(thread(page)).toBeVisible();
}

/** Escribe en el hilo abierto, publica y espera el `201`. */
async function postComment(page: Page, text: string): Promise<void> {
  const posted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      /\/api\/groups\/[^/]+\/links\/[^/]+\/comments$/.test(new URL(response.url()).pathname) &&
      response.status() === 201,
    { timeout: LIVE_TIMEOUT },
  );
  await thread(page).getByTestId('comment-draft').fill(text);
  await thread(page).getByTestId('comment-post').click();
  await posted;
  await expect(threadComment(page, text)).toHaveCount(1);
  await expect(thread(page).getByTestId('comment-draft')).toHaveValue('');
}

async function closeThread(page: Page): Promise<void> {
  await thread(page).getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.locator('mat-dialog-container')).toHaveCount(0);
}

test('group comments flow: share with a note, comment live, moderate and leave', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const owner = await ownerContext.newPage();
    const member = await memberContext.newPage();
    for (const page of [owner, member]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    }
    let groupUrl = '';
    let inviteCode = '';

    await test.step('7.1 the owner creates a group and shares a job post with a note', async () => {
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

      const saved = owner.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/links' &&
          response.status() === 201,
        { timeout: LIVE_TIMEOUT },
      );
      await owner.getByLabel('Pega el enlace de una oferta').fill(OFFER_URL);
      await owner.getByLabel('Nota para el grupo (opcional)').fill(NOTE);
      await owner.getByRole('button', { name: 'Guardar', exact: true }).click();
      const response = await saved;
      expect(response.request().postDataJSON()).toMatchObject({ note: NOTE });

      await expect(offerRow(owner)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(offerRow(owner).getByTestId('link-note-text')).toHaveText(NOTE, {
        timeout: LIVE_TIMEOUT,
      });
    });

    await test.step('7.1 a member joins and sees the note on the card', async () => {
      await member.goto('/registro');
      await register(member, MEMBER);
      await expect(member).toHaveURL(/\/grupos$/);

      await member.goto(`/unirse?codigo=${inviteCode}`);
      await member.getByRole('dialog').getByRole('button', { name: 'Unirme' }).click();
      await expect(member).toHaveURL(groupUrl);
      await openGroup(member, groupUrl);

      const row = offerRow(member);
      await expect(row.getByTestId('link-note-author')).toHaveText(`Nota de ${OWNER.displayName}`, {
        timeout: LIVE_TIMEOUT,
      });
      await expect(row.getByTestId('link-note-text')).toHaveText(NOTE);
      // Ni compartió el link ni es propietario: no puede quitar la nota.
      await expect(row.getByTestId('link-note-remove')).toHaveCount(0);
      await expect(row.getByTestId('link-comments-open')).toHaveText('Comentar');
    });

    await test.step('7.2 the member comments and the owner sees it live, without reloading', async () => {
      await openGroup(owner, groupUrl);
      await expect(offerRow(owner).getByTestId('link-comments-open')).toHaveText('Comentar', {
        timeout: LIVE_TIMEOUT,
      });
      await expect(offerRow(owner).getByTestId('link-comment')).toHaveCount(0);

      await openThread(member);
      await expect(thread(member)).toContainText('Todavía nadie comentó esta oferta.');
      await expect(thread(member)).toContainText(
        'Lo verán los miembros de este grupo y seguirá aquí aunque salgas.',
      );
      await postComment(member, FIRST_COMMENT);
      await member.screenshot({ path: join(SCREENSHOT_DIR, 'hilo.png'), fullPage: true });

      // La pantalla de la propietaria no se recarga: el aviso llega por el canal de eventos.
      await expect(cardComment(owner, FIRST_COMMENT)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(cardComment(owner, FIRST_COMMENT)).toContainText(MEMBER.displayName);
      await expect(offerRow(owner).getByTestId('link-comments-open')).toHaveText('Responder', {
        timeout: LIVE_TIMEOUT,
      });
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'comentario-en-vivo.png'), fullPage: true });

      await closeThread(member);
      await expect(cardComment(member, FIRST_COMMENT)).toHaveCount(1);
      await expect(offerRow(member).getByTestId('link-note-text')).toHaveText(NOTE);
      await member.screenshot({
        path: join(SCREENSHOT_DIR, 'nota-y-comentarios.png'),
        fullPage: true,
      });
    });

    await test.step("7.3 the owner deletes the member's comment and it disappears for both", async () => {
      await openThread(owner);
      const comment = threadComment(owner, FIRST_COMMENT);
      await expect(comment).toHaveCount(1);
      await comment.getByTestId('comment-delete').click();

      const confirmation = dialogWith(owner, 'lv-confirm-dialog');
      await expect(confirmation).toContainText(
        `¿Borrar el comentario de ${MEMBER.displayName}? Desaparecerá para todo el grupo y no se puede deshacer.`,
      );
      const deleted = owner.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /\/api\/groups\/[^/]+\/links\/[^/]+\/comments\/[^/]+$/.test(
            new URL(response.url()).pathname,
          ) &&
          response.status() === 200,
        { timeout: LIVE_TIMEOUT },
      );
      await confirmation.getByRole('button', { name: 'Borrar', exact: true }).click();
      await deleted;

      await expect(threadComment(owner, FIRST_COMMENT)).toHaveCount(0);
      await expect(thread(owner)).toContainText('Todavía nadie comentó esta oferta.');
      await closeThread(owner);
      await expect(cardComment(owner, FIRST_COMMENT)).toHaveCount(0);
      await expect(offerRow(owner).getByTestId('link-comments-open')).toHaveText('Comentar');

      // En la pantalla del miembro, sin recargar: antes se veía (paso anterior), ahora desaparece por el canal.
      await expect(cardComment(member, FIRST_COMMENT)).toHaveCount(0, { timeout: LIVE_TIMEOUT });
      await expect(offerRow(member).getByTestId('link-comments-open')).toHaveText('Comentar', {
        timeout: LIVE_TIMEOUT,
      });
    });

    await test.step('7.4 the member comments again and leaves; the comment stays, marked', async () => {
      await openThread(member);
      await postComment(member, SECOND_COMMENT);
      await closeThread(member);
      await expect(cardComment(owner, SECOND_COMMENT)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      // Mientras sigue en el grupo, su comentario no lleva la marca.
      await expect(cardComment(owner, SECOND_COMMENT).getByTestId('comment-author-left')).toHaveCount(0);

      await member.getByRole('button', { name: 'Salir del grupo' }).click();
      await member.getByRole('dialog').getByRole('button', { name: 'Salir', exact: true }).click();
      await expect(member).toHaveURL(/\/grupos$/);
      await expect(member.getByText(GROUP_NAME)).toHaveCount(0);

      await openGroup(owner, groupUrl);
      const comment = cardComment(owner, SECOND_COMMENT);
      await expect(comment).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(comment).toContainText(MEMBER.displayName);
      await expect(comment.getByTestId('comment-author-left')).toHaveText('ya no está en el grupo', {
        timeout: LIVE_TIMEOUT,
      });

      await openThread(owner);
      await expect(
        threadComment(owner, SECOND_COMMENT).getByTestId('comment-author-left'),
      ).toHaveText('ya no está en el grupo');
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'ya-no-esta.png'), fullPage: true });
      await closeThread(owner);
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await memberContext.close();
    await ownerContext.close();
  }
});
