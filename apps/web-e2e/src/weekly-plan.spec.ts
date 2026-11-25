import { type Page, expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resolveProfile } from './support/profile';

/**
 * «Tu semana» (change weekly-plan, tareas 8.1a y 8.1b): la tarjeta del plan semanal encima del tablero de
 * `/postulaciones`. Solo perfil `local`: escribe en Mongo para fechar las ofertas, como `links.spec.ts` (`seedEnrichment`).
 *
 * Preparación común: alta por la interfaz, un grupo, dos ofertas y un gesto sobre cada una. Después, por Mongo:
 * - la oferta A (`Me interesa`) cierra en 3 días: `apply_before_close`;
 * - la oferta B (`Postulé`, hoy) lleva 12 días sin novedades: `follow_up`.
 *
 * El caso de escritorio corre en `chromium` y el de móvil en `mobile` (Pixel 7); `grep`/`grepInvert` de cada proyecto, en
 * `playwright.config.mts`, reparten las etiquetas `@desktop-case` y `@mobile-case`.
 */

const MONGO_URI = process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/linkvault?directConnection=true';
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_ID = Date.now();
/** Las ofertas de cada caso llevan su propio rango de ids: la vacante es canónica y se deduplica entre cuentas. */
const JOB_BASE = jobIdBase(JOB_ID_SLOTS.weeklyPlan);

interface Person {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function personFor(tag: string): Person {
  return {
    displayName: `Smoke Plan ${tag}`,
    email: `smoke-weekly-plan-${tag}+${RUN_ID}@example.com`,
    password: `Plan-pass-${RUN_ID}`,
  };
}

interface Offers {
  readonly closing: { readonly url: string; readonly label: string; readonly title: string };
  readonly quiet: { readonly url: string; readonly label: string; readonly title: string };
}

function offersFor(firstId: number): Offers {
  const closingId = firstId;
  const quietId = firstId + 1;
  return {
    closing: {
      url: `https://www.linkedin.com/jobs/view/analista-de-datos-${closingId}/`,
      label: `analista de datos ${closingId}`,
      title: `Analista de Datos ${closingId}`,
    },
    quiet: {
      url: `https://www.linkedin.com/jobs/view/desarrollador-movil-${quietId}/`,
      label: `desarrollador movil ${quietId}`,
      title: `Desarrollador Móvil ${quietId}`,
    },
  };
}

const COMPANY = 'Startup Andes';
const CLOSING_REASON = 'Cierra en 3 días: postula antes.';
const QUIET_REASON = '12 días sin novedades: manda un seguimiento.';
const DRAFT_QUESTION = '¿Me podrían contar en qué estado está el proceso de selección?';
const WEEKLY_PLAN_PATH = '/api/applications/weekly-plan';
/** Espera de lo que depende de respuestas de la API: con la máquina cargada, 5 s son justos. */
const API_TIMEOUT = 15_000;

function isoDay(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

async function register(page: Page, user: Person): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/);
}

async function createGroup(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Crear un grupo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
}

function offerRow(page: Page, label: string) {
  return page.locator('li').filter({ hasText: label });
}

async function saveOffer(page: Page, url: string, label: string): Promise<void> {
  await page.getByLabel('Pega el enlace de una oferta').fill(url);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(offerRow(page, label)).toHaveCount(1, { timeout: API_TIMEOUT });
}

/** Alta, grupo, dos ofertas y un gesto sobre cada una; luego las fechas por Mongo. */
async function prepare(page: Page, person: Person, offers: Offers): Promise<void> {
  await register(page, person);
  await createGroup(page, `Smoke Plan ${RUN_ID} ${person.displayName}`);
  await saveOffer(page, offers.closing.url, offers.closing.label);
  await saveOffer(page, offers.quiet.url, offers.quiet.label);

  await offerRow(page, offers.closing.label).getByTestId('link-interested').click();
  await expect(offerRow(page, offers.closing.label).getByTestId('link-own-status')).toHaveText(
    /Tu postulación:\s*Interés/,
    { timeout: API_TIMEOUT },
  );
  await offerRow(page, offers.quiet.label).getByTestId('link-applied').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Hoy', exact: true }).click();
  await expect(offerRow(page, offers.quiet.label).getByTestId('link-own-status')).toHaveText(
    /Tu postulación:\s*Postulada/,
    { timeout: API_TIMEOUT },
  );

  await dateOffers(offers);
}

/**
 * El enriquecimiento que el worker habría escrito (título, empresa y cierre) y el estado de B fechado hace 12 días.
 * Se escribe directamente: el worker no descarga LinkedIn y el paso del tiempo no se puede esperar.
 */
async function dateOffers(offers: Offers): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const closing = await db.collection('job_links').updateOne(
      { displayUrl: { $regex: offers.closing.label.split(' ').at(-1) ?? '' } },
      {
        $set: {
          previewStatus: 'enriched',
          'preview.title': offers.closing.title,
          'preview.company': COMPANY,
          'preview.expiresAt': isoDay(Date.now() + 3 * DAY_MS),
          updatedAt: new Date(),
        },
        $inc: { previewVersion: 1 },
      },
    );
    expect(closing.matchedCount).toBe(1);

    const quietLink = await db.collection('job_links').findOneAndUpdate(
      { displayUrl: { $regex: offers.quiet.label.split(' ').at(-1) ?? '' } },
      {
        $set: {
          previewStatus: 'enriched',
          'preview.title': offers.quiet.title,
          'preview.company': COMPANY,
          updatedAt: new Date(),
        },
        $inc: { previewVersion: 1 },
      },
    );
    expect(quietLink).not.toBeNull();
    const twelveDaysAgo = new Date(Date.now() - 12 * DAY_MS);
    const aged = await db
      .collection('applications')
      .updateOne({ linkId: quietLink?._id }, { $set: { statusChangedAt: twelveDaysAgo, appliedAt: twelveDaysAgo } });
    expect(aged.matchedCount).toBe(1);
  } finally {
    await client.close();
  }
}

/** Abre el tablero y espera al plan: la tarjeta se pinta con la respuesta de `GET /api/applications/weekly-plan`. */
async function openBoard(page: Page): Promise<void> {
  const plan = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === WEEKLY_PLAN_PATH && response.ok(),
    { timeout: API_TIMEOUT },
  );
  await page.goto('/postulaciones');
  await plan;
  await expect(page.getByRole('heading', { level: 2, name: 'Tu semana' })).toBeVisible();
}

test.beforeEach(({ baseURL }) => {
  // Solo `local`: la prueba escribe en Mongo, y el perfil `remote` no lo permite (design D9 de e2e-suite).
  const profile = resolveProfile(process.env, baseURL);
  expect(profile.name, 'weekly plan e2e writes to Mongo and only runs in the local profile').toBe('local');
});

test(
  'weekly plan card shows two actions and marks one done',
  { tag: ['@lot1', '@desktop-case'] },
  async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const offers = offersFor(JOB_BASE);
    await prepare(page, personFor('desktop'), offers);

    await openBoard(page);
    const card = page.getByTestId('weekly-plan');
    const actions = card.getByTestId('weekly-plan-action');
    await expect(actions).toHaveCount(2);
    await expect(actions.nth(0)).toContainText(offers.closing.title);
    await expect(actions.nth(0).getByTestId('weekly-plan-reason')).toHaveText(CLOSING_REASON);
    await expect(actions.nth(1)).toContainText(offers.quiet.title);
    await expect(actions.nth(1).getByTestId('weekly-plan-reason')).toHaveText(QUIET_REASON);

    const decided = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${WEEKLY_PLAN_PATH}/decisions` &&
        response.ok(),
      { timeout: API_TIMEOUT },
    );
    await actions.nth(0).getByRole('button', { name: 'Hecho', exact: true }).click();
    await decided;

    // La acción marcada desaparece y la tarjeta ofrece mover la postulación, sin cambiar su estado por su cuenta.
    await expect(actions).toHaveCount(1);
    await expect(card).not.toContainText(offers.closing.title);
    await expect(card.getByTestId('weekly-plan-move-hint')).toHaveText('¿Ya postulaste? Muévela a Postulada');
    expect(pageErrors).toEqual([]);
  },
);

test.describe('on a phone', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test(
    'weekly plan card sits above the columns on mobile and copies a follow-up draft',
    { tag: ['@lot1', '@mobile-case'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      const offers = offersFor(JOB_BASE + 2);
      await prepare(page, personFor('mobile'), offers);

      await openBoard(page);
      const card = page.getByTestId('weekly-plan');
      await expect(card.getByTestId('weekly-plan-action')).toHaveCount(2);
      await expect(page.getByTestId('board')).toBeVisible();

      const cardBox = await card.boundingBox();
      const firstColumnBox = await page.locator('[data-column="interest"]').boundingBox();
      expect(cardBox).not.toBeNull();
      expect(firstColumnBox).not.toBeNull();
      expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(firstColumnBox?.y ?? 0);

      for (const name of ['Hecho', 'Ahora no', 'Ocultar sugerencia']) {
        for (const button of await card.getByRole('button', { name, exact: true }).all()) {
          const box = await button.boundingBox();
          expect(box?.height ?? 0, `the "${name}" button is at least 44 px tall`).toBeGreaterThanOrEqual(44);
        }
      }

      const followUp = card.getByTestId('weekly-plan-action').filter({ hasText: offers.quiet.title });
      await followUp.getByRole('button', { name: 'Preparar seguimiento' }).click();
      await expect(followUp.getByTestId('weekly-plan-draft-text')).toContainText(offers.quiet.title);
      await followUp.getByRole('button', { name: 'Copiar' }).click();
      await expect(followUp.getByTestId('weekly-plan-copied')).toBeVisible();

      const clipboard = await page.evaluate(() => navigator.clipboard.readText());
      expect(clipboard).toContain(DRAFT_QUESTION);
      expect(clipboard.split('\n').at(-1)).toBe(DRAFT_QUESTION);
    },
  );
});
