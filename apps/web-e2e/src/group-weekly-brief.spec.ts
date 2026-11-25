import { type Page, expect, test } from '@playwright/test';
import { isoWeekKey, previousWeekKey } from '@linkvault/shared';
import { MongoClient, ObjectId } from 'mongodb';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resolveProfile } from './support/profile';

/**
 * «La semana del grupo» (change group-weekly-brief, tareas 7.1a y 7.1b): la tarjeta encima del listado de links de
 * `/grupos/:id`. Solo perfil `local`: escribe en Mongo el documento de la semana en curso, como `weekly-plan.spec.ts`
 * escribe las fechas de las ofertas. `e2e.env` apaga `FEATURE_GROUP_BRIEF` para que el `worker` de la pila no lo
 * recalcule ni lo borre (N5); `replaceOne` + `upsert` evita chocar con un documento que ya existiera.
 *
 * Preparación común: alta por la interfaz, un grupo y tres ofertas guardadas. Por Mongo: título, empresa y cierre de las
 * ofertas A y B, y el documento de la semana con tres viñetas:
 * - cierre próximo: A (en 2 días) y B (en 4 días);
 * - habilidad `Docker`: A y B, de 3 ofertas abiertas;
 * - compartida la semana pasada: C.
 *
 * El caso de escritorio corre en `chromium` y el de móvil (más el estado vacío) en `mobile` (Pixel 7); `grep`/`grepInvert`
 * de cada proyecto, en `playwright.config.mts`, reparten las etiquetas `@desktop-case` y `@mobile-case`.
 */

const MONGO_URI = process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/linkvault?directConnection=true';
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_ID = Date.now();
/** Las ofertas de cada caso llevan su propio rango de ids: la vacante es canónica y se deduplica entre cuentas. */
const JOB_BASE = jobIdBase(JOB_ID_SLOTS.groupBrief);
const COMPANY = 'Startup Andes';
/** Espera de lo que depende de respuestas de la API: con la máquina cargada, 5 s son justos. */
const API_TIMEOUT = 15_000;

interface Person {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

function personFor(tag: string): Person {
  return {
    displayName: `Smoke Brief ${tag}`,
    email: `smoke-group-brief-${tag}+${RUN_ID}@example.com`,
    password: `Brief-pass-${RUN_ID}`,
  };
}

interface Offer {
  readonly id: number;
  readonly url: string;
  readonly label: string;
  readonly title: string;
}

function offerFor(id: number): Offer {
  return {
    id,
    url: `https://www.linkedin.com/jobs/view/ingeniero-de-datos-${id}/`,
    label: `ingeniero de datos ${id}`,
    title: `Ingeniero de Datos ${id}`,
  };
}

function isoDay(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/** El formato de fecha de la tarjeta (spec web/group-weekly-brief): día de la semana, día y mes, en UTC y en español. */
function longDate(isoDate: string): string {
  return new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(`${isoDate}T00:00:00Z`),
  );
}

async function register(page: Page, user: Person): Promise<void> {
  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/);
}

/** Crea el grupo y devuelve su id, que está en la URL del detalle. */
async function createGroup(page: Page, name: string): Promise<string> {
  await page.getByRole('button', { name: 'Crear un grupo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(name);
  await dialog.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
  return /\/grupos\/([0-9a-f]{24})$/.exec(page.url())?.[1] ?? '';
}

async function saveOffer(page: Page, offer: Offer): Promise<void> {
  await page.getByLabel('Pega el enlace de una oferta').fill(offer.url);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('li').filter({ hasText: offer.label })).toHaveCount(1, { timeout: API_TIMEOUT });
}

interface Seeded {
  readonly groupId: string;
  readonly today: string;
  readonly firstExpiresAt: string;
  readonly secondExpiresAt: string;
}

/**
 * Título, empresa y cierre de A y B, y el documento de la semana en curso. Se escribe directamente: el `worker` de la
 * pila tiene la función apagada y el paso del tiempo no se puede esperar.
 */
async function seedBrief(groupId: string, offers: readonly [Offer, Offer, Offer]): Promise<Seeded> {
  const [a, b, c] = offers;
  const now = Date.now();
  const today = isoDay(now);
  const firstExpiresAt = isoDay(now + 2 * DAY_MS);
  const secondExpiresAt = isoDay(now + 4 * DAY_MS);
  const weekKey = isoWeekKey(new Date(now));

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    const ids = new Map<number, string>();
    for (const [offer, expiresAt] of [
      [a, firstExpiresAt],
      [b, secondExpiresAt],
      [c, undefined],
    ] as const) {
      const link = await db.collection('job_links').findOneAndUpdate(
        { displayUrl: { $regex: String(offer.id) } },
        {
          $set: {
            previewStatus: 'enriched',
            'preview.title': offer.title,
            'preview.company': COMPANY,
            ...(expiresAt === undefined ? {} : { 'preview.expiresAt': expiresAt }),
            updatedAt: new Date(),
          },
          $inc: { previewVersion: 1 },
        },
      );
      expect(link, `the offer ${offer.id} was saved`).not.toBeNull();
      ids.set(offer.id, link?._id.toHexString() ?? '');
    }
    const [idA, idB, idC] = [a, b, c].map((offer) => ids.get(offer.id) ?? '');

    const document = {
      groupId: new ObjectId(groupId),
      weekKey,
      asOf: today,
      computedAt: new Date(now),
      version: 1,
      scanTruncated: false,
      facts: [
        { kind: 'open_offers', factId: 'open_offers', count: 3, linkIds: [idA, idB, idC] },
        {
          kind: 'closing_soon',
          factId: 'closing_soon',
          count: 2,
          linkIds: [idA, idB],
          from: today,
          until: isoDay(now + 7 * DAY_MS),
          firstExpiresAt,
        },
        {
          kind: 'skill_demand',
          factId: 'skill_demand:docker',
          skillKey: 'docker',
          skillLabel: 'Docker',
          count: 2,
          total: 3,
          linkIds: [idA, idB],
        },
        {
          kind: 'shared_last_week',
          factId: 'shared_last_week',
          count: 1,
          linkIds: [idC],
          weekKey: previousWeekKey(weekKey),
        },
      ],
      bullets: [
        { factId: 'closing_soon', source: 'template' },
        { factId: 'skill_demand:docker', source: 'template' },
        { factId: 'shared_last_week', source: 'template' },
      ],
    };
    await db
      .collection('group_weekly_briefs')
      .replaceOne({ groupId: document.groupId, weekKey }, document, { upsert: true });
  } finally {
    await client.close();
  }
  return { groupId, today, firstExpiresAt, secondExpiresAt };
}

/** Alta, grupo, tres ofertas y el documento de la semana. Termina en el detalle del grupo, ya sin tarjeta cargada. */
async function prepare(page: Page, person: Person, firstId: number): Promise<Seeded> {
  await register(page, person);
  const groupId = await createGroup(page, `Smoke Brief ${RUN_ID} ${person.displayName}`);
  const offers = [offerFor(firstId), offerFor(firstId + 1), offerFor(firstId + 2)] as const;
  for (const offer of offers) {
    await saveOffer(page, offer);
  }
  return await seedBrief(groupId, offers);
}

/** Abre el detalle y espera a la respuesta de la semana: la tarjeta se pinta con `GET /api/groups/:id/weekly-brief`. */
async function openGroup(page: Page, groupId: string): Promise<void> {
  const brief = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === `/api/groups/${groupId}/weekly-brief` &&
      response.ok(),
    { timeout: API_TIMEOUT },
  );
  await page.goto(`/grupos/${groupId}`);
  await brief;
  await expect(page.getByRole('heading', { level: 2, name: 'La semana del grupo' })).toBeVisible();
}

test.beforeEach(({ baseURL }) => {
  // Solo `local`: la prueba escribe en Mongo, y el perfil `remote` no lo permite (design D9 de e2e-suite).
  const profile = resolveProfile(process.env, baseURL);
  expect(profile.name, 'group weekly brief e2e writes to Mongo and only runs in the local profile').toBe('local');
});

test(
  'group weekly brief card shows the week and expands two offers',
  { tag: ['@lot1', '@desktop-case'] },
  async ({ page }) => {
    test.setTimeout(180_000);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const seeded = await prepare(page, personFor('desktop'), JOB_BASE);

    await openGroup(page, seeded.groupId);
    const card = page.getByTestId('group-weekly-brief');
    await expect(card.getByTestId('group-weekly-brief-header')).toHaveText(
      `Actualizada el ${longDate(seeded.today)} · 3 ofertas abiertas`,
    );
    await expect(card.getByTestId('group-weekly-brief-bullet-text')).toHaveText([
      `2 ofertas cierran en los próximos días; la primera, el ${longDate(seeded.firstExpiresAt)}.`,
      'Docker aparece en 2 de las 3 ofertas abiertas con habilidades detectadas.',
      'Se compartió 1 oferta en el grupo la semana pasada.',
    ]);
    await expect(card.getByTestId('group-weekly-brief-footer')).toHaveText(
      'Solo cuenta datos de las ofertas, nunca lo que hace cada miembro.',
    );

    const toggle = card.getByRole('button', { name: 'Ver ofertas (2)' }).first();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(card.getByRole('button', { name: 'Ocultar ofertas' }).first()).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    const links = card.getByTestId('group-weekly-brief-offer-link');
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveText(`Ingeniero de Datos ${JOB_BASE}`);
    await expect(links.nth(1)).toHaveText(`Ingeniero de Datos ${JOB_BASE + 1}`);
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(link).toHaveAttribute('href', /^https:\/\/www\.linkedin\.com\/jobs\/view\//);
    }
    await expect(card.getByTestId('group-weekly-brief-offer-closes')).toHaveText([
      `cierra el ${longDate(seeded.firstExpiresAt)}`,
      `cierra el ${longDate(seeded.secondExpiresAt)}`,
    ]);
    expect(pageErrors).toEqual([]);
  },
);

test.describe('on a phone', () => {
  test(
    'group weekly brief card sits above the list, has tall buttons and an empty state',
    { tag: ['@lot1', '@mobile-case'] },
    async ({ page }) => {
      test.setTimeout(180_000);
      const seeded = await prepare(page, personFor('mobile'), JOB_BASE + 3);

      await openGroup(page, seeded.groupId);
      const card = page.getByTestId('group-weekly-brief');
      await expect(card.getByTestId('group-weekly-brief-bullet')).toHaveCount(3);
      const list = page.getByTestId('link-list');
      await expect(list).toBeVisible();

      const cardBox = await card.boundingBox();
      const listBox = await list.boundingBox();
      expect(cardBox).not.toBeNull();
      expect(listBox).not.toBeNull();
      expect((cardBox?.y ?? 0) + (cardBox?.height ?? 0)).toBeLessThanOrEqual(listBox?.y ?? 0);

      const toggles = card.getByTestId('group-weekly-brief-toggle');
      await expect(toggles).toHaveCount(3);
      for (const toggle of await toggles.all()) {
        const box = await toggle.boundingBox();
        expect(box?.height ?? 0, 'the "Ver ofertas" button is at least 44 px tall').toBeGreaterThanOrEqual(44);
      }

      // Otro grupo de la misma cuenta, sin documento: el vacío honesto.
      await page.goto('/grupos');
      await createGroup(page, `Smoke Brief ${RUN_ID} vacio`);
      const empty = page.getByTestId('group-weekly-brief-empty');
      await expect(empty).toContainText('Todavía no hay novedades para resumir esta semana.', {
        timeout: API_TIMEOUT,
      });
      await expect(page.getByTestId('group-weekly-brief-bullet')).toHaveCount(0);
    },
  );
});
