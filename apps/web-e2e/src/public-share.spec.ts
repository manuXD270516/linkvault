import { workspaceRoot } from '@nx/devkit';
import { type Page, expect, test } from '@playwright/test';
import { join } from 'node:path';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'public-preview-share');

/**
 * Origen de la **api**, no el del SPA. La página pública vive en `/p/:slug`, que queda **fuera** del prefijo `/api`, y
 * el proxy del dev server solo reenvía `/api`: pedirla al origen del SPA devolvería el `index.html` de Angular y el
 * test pasaría sin probar nada (critic 18, D13). Se puede apuntar a otro entorno con `LINKVAULT_API_ORIGIN`.
 */
const API_ORIGIN = process.env['LINKVAULT_API_ORIGIN'] ?? 'http://localhost:3000';

const RUN_ID = Date.now();
/** Id de oferta de este spec: único aunque otro spec arranque en el mismo milisegundo. */
const JOB_ID = jobIdBase(JOB_ID_SLOTS.public);
/** Propietaria del grupo: comparte la oferta, reparte su enlace público y al final lo apaga. */
const OWNER = {
  displayName: 'Smoke Ana',
  email: `smoke-public-owner+${RUN_ID}@example.com`,
  password: `Owner-pass-${RUN_ID}`,
};
/** Quien llega desde un chat: abre la oferta sin cuenta, pulsa el CTA y se registra. */
const VISITOR = {
  displayName: 'Smoke Beto',
  email: `smoke-public-visitor+${RUN_ID}@example.com`,
  password: `Visitor-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Enlace público ${RUN_ID}`;

// Oferta de LinkedIn con un identificador propio de esta ejecución: el worker no descarga LinkedIn (su `robots.txt` lo
// prohíbe), así que la tarjeta y la página pública se quedan con la etiqueta de la URL, y ninguna ejecución hereda la
// vacante de otra.
const OFFER_URL = `https://www.linkedin.com/jobs/view/backend-developer-${JOB_ID}/`;
const OFFER_LABEL = `backend developer ${JOB_ID}`;

/** Espera de las comprobaciones que dependen de datos: la lista recién pedida o el preview público. */
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

/** Fila de una lista de links con esa oferta. */
function offerRow(page: Page) {
  return page.locator('li').filter({ hasText: OFFER_LABEL });
}

/** El diálogo que contiene ese componente: la tarjeta y su confirmación pueden estar a la vez en pantalla. */
function dialogWith(page: Page, selector: string) {
  return page.locator('mat-dialog-container').filter({ has: page.locator(selector) });
}

/** Abre el detalle del grupo y espera a la primera página de sus links: sin ella, una ausencia pasaría en vacío. */
async function openGroup(page: Page, groupUrl: string): Promise<void> {
  const groupId = new URL(groupUrl).pathname.split('/').at(-1) ?? '';
  const links = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/groups/${groupId}/links` &&
      response.ok(),
    { timeout: LIVE_TIMEOUT },
  );
  await page.goto(groupUrl);
  await links;
}

/** Abre `/oferta/:slug` esperando al preview público, y devuelve su código de respuesta. */
async function openPublicView(page: Page, slug: string): Promise<number> {
  const preview = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/public/previews/${slug}`,
    { timeout: LIVE_TIMEOUT },
  );
  await page.goto(`/oferta/${slug}`);
  return (await preview).status();
}

test('public share flow: the card, the jump, the public view, the sign up and turning it off', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const ownerContext = await browser.newContext();
  const visitorContext = await browser.newContext();
  // Contexto aparte para medir el botón de atrás: así el historial del salto no ensucia el resto del recorrido.
  const jumpContext = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const owner = await ownerContext.newPage();
    const visitor = await visitorContext.newPage();
    const jumper = await jumpContext.newPage();
    for (const page of [owner, visitor, jumper]) {
      page.on('pageerror', (error) => pageErrors.push(error.message));
    }
    /** Peticiones que hace quien llega sin cuenta, para comprobar qué NO se pide en una ruta pública. */
    const visitorRequests: string[] = [];
    visitor.on('request', (request) =>
      visitorRequests.push(`${request.method()} ${new URL(request.url()).pathname}`),
    );

    let groupUrl = '';
    let slug = '';
    let publicUrl = '';

    await test.step('8.1 Ana shares a job in her group and sees "Enlace público" on the card', async () => {
      await owner.goto('/registro');
      await register(owner, OWNER);
      await expect(owner).toHaveURL(/\/grupos$/);

      await owner.getByRole('button', { name: 'Crear un grupo' }).click();
      const dialog = owner.getByRole('dialog');
      await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
      await dialog.getByRole('button', { name: 'Crear grupo' }).click();
      await expect(owner).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      groupUrl = owner.url();

      // El grupo nace con la visibilidad por defecto encendida, así que el link entra ya publicado: el enlace viene en
      // la respuesta del alta, sin una petición más (D12).
      const saved = owner.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/links' &&
          response.status() === 201,
        { timeout: LIVE_TIMEOUT },
      );
      await owner.getByLabel('Pega el enlace de una oferta').fill(OFFER_URL);
      await owner.getByRole('button', { name: 'Guardar', exact: true }).click();
      const body: unknown = await (await saved).json();
      const share = (body as { link?: { publicShare?: { slug?: string; url?: string } } }).link
        ?.publicShare;
      slug = share?.slug ?? '';
      publicUrl = share?.url ?? '';
      expect(slug).toMatch(/^[23456789abcdefghjkmnpqrstvwxyz]{12}$/);
      expect(publicUrl).toContain(`/p/${slug}`);

      await expect(offerRow(owner)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(offerRow(owner).getByTestId('link-public-mark')).toHaveText('Enlace público', {
        timeout: LIVE_TIMEOUT,
      });
      await expect(offerRow(owner).getByTestId('link-public-copy')).toBeVisible();
      await expect(owner.getByTestId('save-link-public')).toContainText(
        'Cualquiera con este enlace verá la oferta, pero no el grupo; tu nombre solo lo verá quien ya comparta un grupo contigo.',
      );
      await owner.screenshot({ path: join(SCREENSHOT_DIR, 'tarjeta-publica.png'), fullPage: true });
    });

    await test.step('8.2 the api serves the public page with its Open Graph card', async () => {
      // Petición cruda al origen de la api: así se lee el HTML tal cual, sin que el `meta refresh` salte al SPA.
      const response = await owner.request.get(`${API_ORIGIN}/p/${slug}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).toContain('text/html');

      const html = await response.text();
      expect(html).toContain('og:title');
      expect(html).toContain(OFFER_LABEL);
      // El salto al SPA: el enlace visible de respaldo y el `meta refresh`, sin una sola etiqueta `<script>`.
      expect(html).toContain(`/oferta/${slug}`);
      expect(html).toContain('http-equiv="refresh"');
      expect(html).not.toContain('<script');
    });

    await test.step('8.3 the public page jumps to the SPA, and the back button is measured', async () => {
      await jumper.goto(`${API_ORIGIN}/p/${slug}`);
      await expect(jumper).toHaveURL(new RegExp(`/oferta/${slug}$`), { timeout: LIVE_TIMEOUT });

      // Qué hace "atrás" tras un `<meta refresh>` varía entre motores, así que **no se afirma**: se observa y se anota
      // (critic I2, tarea 8.3). Lo único que se exige es que no se quede en un bucle que impida salir.
      await jumper.goBack({ waitUntil: 'commit' }).catch(() => undefined);
      // eslint-disable-next-line no-restricted-syntax -- espera observacional (tarea 8.3): no sincroniza nada, deja pasar tiempo para anotar la URL tras «atrás», que no se afirma
      await jumper.waitForTimeout(2000);
      const afterBack = jumper.url();
      // eslint-disable-next-line no-restricted-syntax -- espera observacional (tarea 8.3): segunda lectura de la URL, dos segundos después, para anotar si se asienta
      await jumper.waitForTimeout(2000);
      const settled = jumper.url();

      await test.info().attach('retroceso-tras-el-meta-refresh', {
        body: [
          `1. goto: ${API_ORIGIN}/p/${slug}`,
          `2. tras el refresh: /oferta/${slug}`,
          `3. justo tras goBack(): ${afterBack}`,
          `4. dos segundos después: ${settled}`,
        ].join('\n'),
        contentType: 'text/plain',
      });

      // Sin bucle: el retroceso se queda donde se quede, pero deja de moverse.
      expect(settled).toBe(afterBack);
      // Y, vaya donde vaya, seguir navegando funciona: el historial no atrapa a nadie.
      await jumper.goto(`/oferta/${slug}`);
      await expect(jumper.getByTestId('public-save')).toBeVisible({ timeout: LIVE_TIMEOUT });
    });

    await test.step('8.4 the public view opens without a session and without asking for one', async () => {
      expect(await openPublicView(visitor, slug)).toBe(200);

      await expect(visitor.getByTestId('public-headline')).toHaveText(OFFER_LABEL, {
        timeout: LIVE_TIMEOUT,
      });
      await expect(visitor.getByTestId('public-original')).toHaveAttribute(
        'rel',
        'noopener noreferrer',
      );
      await expect(visitor.getByTestId('public-save')).toHaveText('Guardar en LinkVault');
      await expect(visitor.getByTestId('public-save-hint')).toHaveText(
        'Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.',
      );
      // No se dice nada de nadie: ni quién la compartió, ni de qué grupo es.
      await expect(visitor.getByText(OWNER.displayName)).toHaveCount(0);
      await expect(visitor.getByText(GROUP_NAME)).toHaveCount(0);
      // La sesión no se restaura al arrancar en una ruta pública: ni refresh, ni "Conectando…".
      expect(visitorRequests.filter((entry) => entry.includes('/api/auth/'))).toEqual([]);
      expect(
        visitorRequests.filter((entry) => entry === `GET /api/public/previews/${slug}`),
      ).toHaveLength(1);
      await expect(visitor.getByText('Conectando…')).toHaveCount(0);
      // Y no se indexa.
      await expect(visitor.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
      await visitor.screenshot({ path: join(SCREENSHOT_DIR, 'vista-publica.png'), fullPage: true });
    });

    await test.step('8.5 Beto, with no account, saves the job, signs up and finds it in his list', async () => {
      await visitor.getByTestId('public-save').click();
      await expect(visitor).toHaveURL(new RegExp(`/registro\\?import=${slug}$`), {
        timeout: LIVE_TIMEOUT,
      });

      const imported = visitor.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/api/links' &&
          response.status() === 201,
        { timeout: LIVE_TIMEOUT },
      );
      await register(visitor, VISITOR);
      await expect(visitor).toHaveURL(/\/mis-links/, { timeout: LIVE_TIMEOUT });
      const request = await imported;
      expect(request.request().postDataJSON()).toEqual({ url: OFFER_URL });

      await expect(visitor.getByTestId('import-outcome')).toContainText(
        'Guardada en «Solo para mí». Compártela en un grupo cuando quieras.',
        { timeout: LIVE_TIMEOUT },
      );
      await expect(offerRow(visitor)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      // El parámetro desaparece de la URL: recargar no vuelve a guardarla.
      await expect(visitor).toHaveURL(/\/mis-links$/, { timeout: LIVE_TIMEOUT });
      // Y en la lista privada no hay enlace público que enseñar.
      await expect(offerRow(visitor).getByTestId('link-public-mark')).toHaveCount(0);
      await visitor.screenshot({ path: join(SCREENSHOT_DIR, 'importada.png'), fullPage: true });
    });

    await test.step('8.6 Ana stops sharing and the public link dies for everyone', async () => {
      await openGroup(owner, groupUrl);
      const unpublished = owner.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /\/api\/groups\/[^/]+\/links\/[^/]+\/public$/.test(new URL(response.url()).pathname) &&
          response.status() === 204,
        { timeout: LIVE_TIMEOUT },
      );
      await offerRow(owner).getByTestId('link-public-off').click();
      const confirmation = dialogWith(owner, 'lv-confirm-dialog');
      await expect(confirmation).toContainText(
        'El enlace dejará de funcionar para todo el mundo, también para quien ya lo tenga.',
      );
      await confirmation.getByRole('button', { name: 'Dejar de compartir', exact: true }).click();
      await unpublished;

      // La tarjeta se apaga sin recargar la lista.
      await expect(offerRow(owner).getByTestId('link-public-mark')).toHaveCount(0, {
        timeout: LIVE_TIMEOUT,
      });
      await expect(offerRow(owner).getByTestId('link-public-on')).toBeVisible();

      // El enlace repartido deja de funcionar: `404` en la página de la api y en la vista del SPA.
      const burnt = await owner.request.get(`${API_ORIGIN}/p/${slug}`);
      expect(burnt.status()).toBe(404);
      expect(burnt.headers()['content-type']).toContain('text/html');

      expect(await openPublicView(visitor, slug)).toBe(404);
      await expect(visitor.getByTestId('public-gone')).toContainText(
        'Este enlace ya no está disponible',
        { timeout: LIVE_TIMEOUT },
      );
      await expect(visitor.getByTestId('public-gone')).toContainText(
        'Pídeselo de nuevo a quien te lo envió',
      );
      // Sin nada que guardar, el CTA desaparece.
      await expect(visitor.getByTestId('public-save')).toHaveCount(0);
      await visitor.screenshot({
        path: join(SCREENSHOT_DIR, 'enlace-apagado.png'),
        fullPage: true,
      });
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await jumpContext.close();
    await visitorContext.close();
    await ownerContext.close();
  }
});
