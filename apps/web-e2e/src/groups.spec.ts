import { workspaceRoot } from '@nx/devkit';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'groups');
const APP_ORIGIN = 'http://localhost:4200';

const RUN_ID = Date.now();
const OWNER = {
  displayName: 'Smoke Owner',
  email: `smoke-owner+${RUN_ID}@example.com`,
  password: `Owner-pass-${RUN_ID}`,
};
const JOINER = {
  displayName: 'Smoke Joiner',
  email: `smoke-joiner+${RUN_ID}@example.com`,
  password: `Joiner-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Grupo ${RUN_ID}`;

/** Alfabeto del código de invitación (D3): base32 de Crockford sin `0`, `1`, `I`, `L`, `O` ni `U`. */
const INVITE_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/** Registra lo último copiado, por si Chromium deja escribir en el portapapeles pero no leerlo. */
function captureClipboardWrites(): void {
  try {
    const clipboard = navigator.clipboard;
    const original = clipboard.writeText.bind(clipboard);
    clipboard.writeText = (text: string): Promise<void> => {
      (window as unknown as { __lastCopied?: string }).__lastCopied = text;
      return original(text);
    };
  } catch {
    // Sin portapapeles que envolver: la página usará su respaldo de selección.
  }
}

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string },
): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

/**
 * Mensaje de invitación copiado, por el camino que haya funcionado: el portapapeles real, lo que registró el envoltorio
 * o el respaldo de selección que muestra la página cuando no hay portapapeles. Cadena vacía si ninguno.
 */
async function readInvitation(page: Page): Promise<string> {
  const copied = await page.evaluate(async () => {
    const recorded = (window as unknown as { __lastCopied?: string }).__lastCopied ?? '';
    try {
      const fromClipboard = await navigator.clipboard.readText();
      if (fromClipboard !== '') {
        return fromClipboard;
      }
    } catch {
      // El navegador no deja leer el portapapeles.
    }
    return recorded;
  });
  if (copied !== '') {
    return copied;
  }
  const fallback = page.getByTestId('invitation-fallback');
  return (await fallback.count()) > 0 ? await fallback.inputValue() : '';
}

test('groups flow: create, invite link, members, expel, leave and delete', async ({ browser }) => {
  test.setTimeout(180_000);
  // El permiso de portapapeles se concede en el contexto; si Chromium lo deniega igualmente, quedan los otros caminos.
  const ownerContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  await ownerContext.addInitScript(captureClipboardWrites);
  const joinerContext = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const owner = await ownerContext.newPage();
    const joiner = await joinerContext.newPage();
    for (const page of [owner, joiner]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    }
    let inviteCode = '';
    let groupUrl = '';

    await test.step('the first user registers and lands on the empty group list', async () => {
      await owner.goto('/registro');
      await register(owner, OWNER);

      await expect(owner).toHaveURL(/\/grupos$/);
      await expect(owner.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
      await expect(
        owner.getByText(
          'Un grupo es donde tú y tu círculo juntan las ofertas de empleo que encuentran',
        ),
      ).toBeVisible();
      await expect(owner.getByText('Crea un grupo o únete con un código')).toBeVisible();
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'lista-vacia.png'), fullPage: true });
    });

    await test.step('create a group and see its invite code', async () => {
      await owner.getByRole('button', { name: 'Crear un grupo' }).click();
      const dialog = owner.getByRole('dialog');
      await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
      await dialog.getByRole('button', { name: 'Crear grupo' }).click();

      await expect(owner).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      groupUrl = owner.url();
      await expect(owner.getByRole('heading', { level: 1, name: GROUP_NAME })).toBeVisible();
      await expect(
        owner.getByText(
          'Aquí aparecerán las ofertas que compartan los miembros. Pronto podrás guardar links en este grupo.',
        ),
      ).toBeVisible();
      await expect(
        owner.getByText(
          'Quien tenga este código puede entrar y ver los nombres de los miembros. Regenéralo si se filtró.',
        ),
      ).toBeVisible();

      inviteCode = ((await owner.getByTestId('invite-code').textContent()) ?? '').trim();
      expect(inviteCode).toMatch(INVITE_CODE);
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'detalle-owner.png'), fullPage: true });
    });

    await test.step('copy the invitation with the absolute link', async () => {
      await owner.getByRole('button', { name: 'Copiar invitación' }).click();

      const invitation = await readInvitation(owner);
      expect(invitation).toContain(GROUP_NAME);
      expect(invitation).toContain(`${APP_ORIGIN}/unirse?codigo=${inviteCode}`);
      expect(invitation).toContain(`(código ${inviteCode})`);
    });

    await test.step('a second user without account joins from the invitation link', async () => {
      await joiner.goto(`/unirse?codigo=${inviteCode}`);

      // Ruta autenticada: el enlace se recuerda en `returnUrl` hasta después del registro.
      await expect(joiner).toHaveURL(/\/login\?returnUrl=%2Funirse%3Fcodigo%3D/);
      await joiner.getByRole('link', { name: 'Crear cuenta' }).click();
      await expect(joiner).toHaveURL(/\/registro\?returnUrl=%2Funirse%3Fcodigo%3D/);
      await register(joiner, JOINER);

      // Vuelve a `/unirse` con el código escrito, y la página lo quita de la URL.
      await expect(joiner).toHaveURL(/\/unirse$/);
      const dialog = joiner.getByRole('dialog');
      await expect(dialog.getByLabel('Código de invitación', { exact: true })).toHaveValue(
        inviteCode,
      );
      await joiner.screenshot({ path: join(SCREENSHOT_DIR, 'unirse.png'), fullPage: true });

      await dialog.getByRole('button', { name: 'Unirme' }).click();
      await expect(joiner).toHaveURL(groupUrl);
      await expect(joiner.getByRole('heading', { level: 1, name: GROUP_NAME })).toBeVisible();
    });

    await test.step('both users see the two members, and only the owner sees the code', async () => {
      await expect(
        joiner.getByRole('listitem').filter({ hasText: OWNER.displayName }),
      ).toContainText('Propietario');
      await expect(
        joiner.getByRole('listitem').filter({ hasText: JOINER.displayName }),
      ).toContainText('Miembro');
      await expect(joiner.getByRole('listitem').first()).toContainText('Desde el');
      await expect(joiner.getByTestId('invite-code')).toHaveCount(0);
      await expect(joiner.getByRole('button', { name: 'Borrar el grupo' })).toHaveCount(0);
      await expect(joiner.getByRole('button', { name: 'Salir del grupo' })).toBeVisible();

      await owner.reload();
      await expect(owner.getByRole('listitem')).toHaveCount(2);
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'miembros.png'), fullPage: true });
    });

    await test.step('the second user leaves the group and joins again with the code', async () => {
      await joiner.getByRole('button', { name: 'Salir del grupo' }).click();
      await joiner.getByRole('dialog').getByRole('button', { name: 'Salir', exact: true }).click();

      await expect(joiner).toHaveURL(/\/grupos$/);
      await expect(joiner.getByText(GROUP_NAME)).toHaveCount(0);

      await joiner.goto(`/unirse?codigo=${inviteCode}`);
      await joiner.getByRole('dialog').getByRole('button', { name: 'Unirme' }).click();
      await expect(joiner).toHaveURL(groupUrl);
      await expect(joiner.getByRole('heading', { level: 1, name: GROUP_NAME })).toBeVisible();
    });

    await test.step('the owner expels the member and accepts regenerating the code', async () => {
      await owner.reload();
      await owner.getByRole('button', { name: 'Expulsar', exact: true }).click();
      await owner.getByRole('dialog').getByRole('button', { name: 'Expulsar', exact: true }).click();

      await expect(owner).toHaveURL(groupUrl);
      await expect(owner.getByRole('listitem')).toHaveCount(1);
      await expect(owner.getByRole('listitem').first()).toContainText(OWNER.displayName);

      await owner
        .getByRole('button', { name: 'Regenerar el código para que no pueda volver a entrar' })
        .click();
      await expect(owner.getByTestId('invite-code')).not.toHaveText(inviteCode);
      const rotated = ((await owner.getByTestId('invite-code').textContent()) ?? '').trim();
      expect(rotated).toMatch(INVITE_CODE);
    });

    await test.step('the expelled user loses the group and the previous code', async () => {
      await joiner.goto('/grupos');
      await expect(joiner.getByText(GROUP_NAME)).toHaveCount(0);

      await joiner.goto(`/unirse?codigo=${inviteCode}`);
      await joiner.getByRole('dialog').getByRole('button', { name: 'Unirme' }).click();
      await expect(
        joiner.getByRole('alert').filter({ hasText: 'Ese código no corresponde a ningún grupo' }),
      ).toBeVisible();
    });

    await test.step('the owner deletes the group after a confirmation that says who it affects', async () => {
      await owner.getByRole('button', { name: 'Borrar el grupo' }).click();
      const dialog = owner.getByRole('dialog');
      await expect(dialog).toContainText(
        /Se borrará para los \d+ miembros\. No se puede deshacer\./,
      );
      await owner.screenshot({
        path: join(SCREENSHOT_DIR, 'confirmar-borrado.png'),
        fullPage: true,
      });

      await dialog.getByRole('button', { name: 'Borrar', exact: true }).click();

      await expect(owner).toHaveURL(/\/grupos$/);
      await expect(owner.getByText(GROUP_NAME)).toHaveCount(0);
      await expect(owner.getByText('Crea un grupo o únete con un código')).toBeVisible();

      await owner.goto(groupUrl);
      await expect(
        owner.getByRole('alert').filter({ hasText: 'Ese grupo no existe o ya no perteneces a él' }),
      ).toBeVisible();
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await ownerContext.close();
    await joinerContext.close();
  }
});
