import { workspaceRoot } from '@nx/devkit';
import type {
  EnrichmentFailureReason,
  PreviewSources,
  StoredPreview,
} from '@linkvault/shared';
import { type Page, expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'job-links');
/** Las capturas del preview son de `link-enrichment`, no de `job-links`: cada change guarda las suyas. */
const ENRICHMENT_SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'link-enrichment');
/** Y las de pegar la descripción, de `paste-job-description`. */
const PASTE_SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'paste-job-description');

/**
 * Base de `api`, para escribir en `job_links` lo que el worker habría escrito al leer la página. Es el mismo valor por
 * defecto de `.env.example`; con un `.env` propio, Nx lo pasa en `MONGO_URI` y manda ese.
 */
const MONGO_URI =
  process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/linkvault?directConnection=true';

const RUN_ID = Date.now();
const USER = {
  displayName: 'Smoke Links',
  email: `smoke-links+${RUN_ID}@example.com`,
  password: `Links-pass-${RUN_ID}`,
};
/** Otro miembro del grupo, mirando la misma lista mientras el primero pega. */
const MEMBER = {
  displayName: 'Smoke Miembro',
  email: `smoke-links-member+${RUN_ID}@example.com`,
  password: `Member-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Links ${RUN_ID}`;

// El identificador de cada oferta lleva `RUN_ID`, así que cada ejecución guarda vacantes nuevas. No es cosmético: la
// vacante es canónica y se deduplica entre grupos, de modo que unas URLs fijas harían que una ejecución heredara el
// preview y el estado que le dejó la anterior. Con identificadores propios, "Leyendo la oferta…" es de verdad una
// lectura recién pedida y el enriquecimiento que este smoke escribe no puede contaminar la siguiente pasada.
//
// Cada identificador respeta la forma que reconoce su canonicalizador: dígitos en LinkedIn y Trabajopolis, hexadecimal
// en Computrabajo y un slug de tres partes en Get on Board.
const COMPUTRABAJO_ID = RUN_ID.toString(16);

/** URL con slug: lo que se guarda (`displayUrl`) lo conserva, mientras que la normalizada se queda en el id. */
const LINKEDIN_URL = `https://www.linkedin.com/jobs/view/senior-backend-engineer-at-acme-${RUN_ID}/?utm_source=smoke`;
const LINKEDIN_LABEL = `senior backend engineer at acme ${RUN_ID}`;
const COMPUTRABAJO_URL = `https://bo.computrabajo.com/ofertas-de-trabajo/oferta-de-trabajo-de-analista-de-datos-en-acme-${COMPUTRABAJO_ID}`;
const COMPUTRABAJO_LABEL = `oferta de trabajo de analista de datos en acme ${COMPUTRABAJO_ID}`;
/** Lo que alguien pega en el chat sin ser una oferta: se guarda igual y luego se quita. */
const VIDEO_URL = `https://ejemplo.test/videos/video-de-gatos-${RUN_ID}`;
const VIDEO_LABEL = `video de gatos ${RUN_ID}`;
const PRIVATE_URL = `https://www.getonbrd.com/jobs/programming/desarrollador-frontend-senior-acme-remote-${RUN_ID}`;
const PRIVATE_LABEL = `desarrollador frontend senior acme remote ${RUN_ID}`;
/** La única de las cinco bolsas cuyo `robots.txt` permite leer una oferta y que además publica JSON-LD (design §Context). */
const TRABAJOPOLIS_URL = `https://www.trabajopolis.bo/trabajo/${RUN_ID}/aviso-acme-bo-${RUN_ID}/`;
const TRABAJOPOLIS_LABEL = `aviso acme bo ${RUN_ID}`;
/** Otra oferta de LinkedIn, para completarla pegando el cuerpo y escribiendo aparte el título y la empresa. */
const LINKEDIN_TYPED_URL = `https://www.linkedin.com/jobs/view/analista-contable-${RUN_ID + 1}/`;
const LINKEDIN_TYPED_LABEL = `analista contable ${RUN_ID + 1}`;
const BLOCKED_TEXT = 'LinkedIn no nos deja leer sus ofertas. Pega su descripción para completarla';

/** Entrada de un caso del golden de `extract-pasted-job`. */
interface PastedGoldenInput {
  text: string;
  knownTitle?: string;
  knownCompany?: string;
}

/**
 * Lo que se pega sale tal cual del golden de `extract-pasted-job`, no de una copia. `api` lee lo pegado con el mock en
 * `replay`, que solo responde a una entrada con fixture grabado: un texto que difiriera en un carácter se quedaría sin
 * respuesta. Leerlo del golden hace que este smoke siga al caso si alguien lo regraba.
 */
function pastedGoldenInput(id: string): PastedGoldenInput {
  const golden = readFileSync(
    join(workspaceRoot, 'libs', 'ai', 'src', 'evals', 'extract-pasted-job', 'golden.jsonl'),
    'utf8',
  );
  for (const line of golden.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const entry = JSON.parse(line) as { id: string; input: PastedGoldenInput };
    if (entry.id === id) {
      return entry.input;
    }
  }
  throw new Error(`The extract-pasted-job golden has no case "${id}"`);
}

/** Una oferta copiada entre mensajes de un chat: trae el puesto y la empresa en el propio texto. */
const PASTED_FROM_CHAT = pastedGoldenInput('oferta-entre-chat');
/** Lo que la IA lee de ella: el fixture grabado de ese caso. */
const CHAT_JOB = {
  title: 'Ingeniero de Soporte TI',
  company: 'Distribuidora Andina',
  location: 'Santa Cruz de la Sierra',
} as const;
/** El cuerpo copiado desde la app de LinkedIn, sin cabecera: el puesto y la empresa se escriben aparte. */
const PASTED_FROM_APP = pastedGoldenInput('linkedin-app-con-titulo-escrito');

const DAY_MS = 24 * 60 * 60 * 1000;

/** Día (`YYYY-MM-DD`) de un instante, que es la precisión con la que una bolsa publica sus fechas. */
function isoDay(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

/** El mismo día escrito como lo escribe la tarjeta (`dd/MM/yyyy`). */
function spanishDay(day: string): string {
  const [year, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}/${month}/${year}`;
}

/**
 * La vacante que la extracción habría leído de la página. Las fechas se calculan desde la ejecución para que
 * "Publicada hace 3 días" siga diciendo lo mismo dentro de un año: `postedAt` es el día UTC de hace tres días, así que
 * la diferencia con el reloj del navegador está siempre entre tres y cuatro días y la tarjeta la trunca a tres.
 */
const JOB = {
  title: 'Desarrollador Full Stack',
  company: 'Acme Bolivia',
  location: 'La Paz, Bolivia',
  modality: 'remote',
  seniority: 'senior',
  salary: { min: 8000, max: 12000, currency: 'BOB', period: 'month' },
  postedAt: isoDay(RUN_ID - 3 * DAY_MS),
  expiresAt: isoDay(RUN_ID + 21 * DAY_MS),
} as const;
/** Lo que una persona corrige a mano sobre lo extraído. */
const CORRECTED_TITLE = 'Ingeniero de Software Senior';

const CHAT = [
  `Ana: mirad esta oferta ${LINKEDIN_URL}`,
  `Beto: y esta otra ${COMPUTRABAJO_URL}`,
  `Ana: nada que ver, pero mirad ${VIDEO_URL}`,
].join('\n');

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string } = USER,
): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
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

/**
 * Deja en `job_links` el resultado de una lectura, como si el worker acabara de terminarla.
 *
 * Es el doble de la extracción: el worker descarga de internet y aquí no se toca la red, así que el enriquecimiento se
 * escribe donde el worker lo habría escrito y lo que el smoke comprueba es lo que sigue —lo que el SPA hace con un
 * preview, con una corrección a mano y con un fallo—. Todo lo demás de estos pasos es de verdad: `PATCH .../preview` y
 * `POST .../enrich` son la API real, con su transacción y su límite por link.
 *
 * `previewVersion` sube como en una escritura del worker, porque la edición manual y el reintento escriben
 * condicionados a ella (D2).
 */
async function seedEnrichment(displayUrl: string, fields: Record<string, unknown>): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const written = await client
      .db()
      .collection('job_links')
      .updateOne(
        { displayUrl },
        { $set: { ...fields, updatedAt: new Date() }, $inc: { previewVersion: 1 } },
      );
    expect(written.matchedCount).toBe(1);
  } finally {
    await client.close();
  }
}

/** Un campo que salió del JSON-LD de la página, con la forma de procedencia que guarda el worker. */
function fromPage<Value>(value: Value, at: string) {
  return { value, source: 'auto', extractor: 'json-ld', at } as const;
}

/**
 * Una lectura que salió bien: los campos de la vacante y de dónde salió cada uno (D4). Lo escrito se declara con los
 * tipos de `libs/shared`, que son los mismos de los que se derivan los schemas de Mongoose: así un cambio del contrato
 * rompe este doble en lugar de dejarlo escribiendo algo que la API descartaría en silencio.
 */
async function seedReadOffer(displayUrl: string): Promise<void> {
  const at = new Date().toISOString();
  const preview: StoredPreview = { ...JOB };
  const previewSources: PreviewSources = {
    title: fromPage(JOB.title, at),
    company: fromPage(JOB.company, at),
    location: fromPage(JOB.location, at),
    modality: fromPage(JOB.modality, at),
    seniority: fromPage(JOB.seniority, at),
    // El salario no estaba en el JSON-LD: lo dedujo la IA, y la tarjeta tiene que decirlo.
    salary: { value: { ...JOB.salary }, source: 'auto', extractor: 'ai:extract-job', at },
    postedAt: fromPage(JOB.postedAt, at),
    expiresAt: fromPage(JOB.expiresAt, at),
  };
  await seedEnrichment(displayUrl, { previewStatus: 'enriched', preview, previewSources });
}

/** Una lectura que no salió: el estado y el motivo con el que la tarjeta decide qué decir y qué ofrecer (D5). */
async function seedFailedRead(
  displayUrl: string,
  reason: EnrichmentFailureReason,
): Promise<void> {
  await seedEnrichment(displayUrl, {
    previewStatus: 'failed',
    lastEnrichmentError: { reason, at: new Date().toISOString() },
  });
}

test('links flow: save, open, import a chat, remove and the private list', async ({ browser }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const memberContext = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    const member = await memberContext.newPage();
    for (const current of [page, member]) {
      current.on('pageerror', (error) => pageErrors.push(error.message));
    }
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
      // La lectura se acaba de pedir: la tarjeta lo dice así, no como una lectura que ya no va a llegar (D5).
      await expect(row).toContainText('Leyendo la oferta…');
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

    await test.step('Oferta enriquecida', async () => {
      await saveLink(page, TRABAJOPOLIS_URL);
      await expect(linkRow(page, TRABAJOPOLIS_LABEL)).toHaveCount(1);

      await seedReadOffer(TRABAJOPOLIS_URL);
      await page.reload();

      const row = linkRow(page, JOB.title);
      await expect(row.getByTestId('link-open')).toHaveText(JOB.title);
      await expect(row.getByTestId('link-company')).toContainText(JOB.company);
      await expect(row.getByTestId('link-location')).toHaveText(JOB.location);
      await expect(row.getByTestId('link-modality')).toHaveText('Remoto');
      await expect(row.getByTestId('link-seniority')).toHaveText('Senior');
      // La etiqueta derivada de la URL desaparece en cuanto la oferta tiene nombre propio.
      await expect(page.getByText(TRABAJOPOLIS_LABEL)).toHaveCount(0);
      // Una oferta legible no necesita que le cuenten nada más.
      await expect(row.getByTestId('link-status')).toHaveCount(0);
      await page.screenshot({ path: join(ENRICHMENT_SCREENSHOT_DIR, 'oferta-enriquecida.png'), fullPage: true });
    });

    await test.step('Oferta con salario y fechas', async () => {
      const row = linkRow(page, JOB.title);
      const salary = row.getByTestId('link-salary');

      // El agrupador de miles lo pone el locale del navegador, así que se comprueba la forma, no sus puntos.
      await expect(salary).toHaveText(/^[\d.,\s]+ – [\d.,\s]+ BOB al mes$/);
      // Deducido por la IA: se enseña sin destacar y se dice quién lo dedujo.
      await expect(salary).toHaveAttribute('data-guess', 'ai');
      await expect(row.getByTestId('note-salary')).toHaveText('Deducido por la IA');
      await expect(row.getByTestId('link-posted')).toHaveText('Publicada hace 3 días');
      await expect(row.getByTestId('link-expires')).toHaveText(
        `Cierra el ${spanishDay(JOB.expiresAt)}`,
      );
    });

    await test.step('Corregir el título', async () => {
      await linkRow(page, JOB.title).getByTestId('link-edit').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('preview-title')).toHaveValue(JOB.title);

      await dialog.getByTestId('preview-title').fill(CORRECTED_TITLE);
      await dialog.getByTestId('preview-save').click();

      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect(linkRow(page, CORRECTED_TITLE).getByTestId('link-open')).toHaveText(
        CORRECTED_TITLE,
      );
      await expect(linkRow(page, JOB.title)).toHaveCount(0);
    });

    await test.step('Quién lo escribió, en la tarjeta', async () => {
      const row = linkRow(page, CORRECTED_TITLE);

      await expect(row.getByTestId('note-title')).toHaveText(`Escrito por ${USER.displayName}`);
      // Lo que leyó la página no se anota: llenaría la tarjeta de ruido y es el caso normal.
      await expect(row.getByTestId('note-company')).toHaveCount(0);
      await page.screenshot({ path: join(ENRICHMENT_SCREENSHOT_DIR, 'oferta-corregida.png'), fullPage: true });
    });

    await test.step('Origen de cada campo', async () => {
      await linkRow(page, CORRECTED_TITLE).getByTestId('link-edit').click();
      const dialog = page.getByRole('dialog');

      await expect(dialog.getByTestId('origin-title')).toHaveText(
        `Escrito por ${USER.displayName}`,
      );
      await expect(dialog.getByTestId('origin-company')).toHaveText('Leído de la página');
      await expect(dialog.getByTestId('origin-salary')).toHaveText('Deducido por la IA');
      await page.screenshot({ path: join(ENRICHMENT_SCREENSHOT_DIR, 'origen-de-cada-campo.png'), fullPage: true });
    });

    await test.step('Volver a lo extraído', async () => {
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('revert-title').click();
      // El formulario enseña ya a qué va a volver, antes de guardar.
      await expect(dialog.getByTestId('preview-title')).toHaveValue(JOB.title);

      await dialog.getByTestId('preview-save').click();

      await expect(page.getByRole('dialog')).toHaveCount(0);
      const row = linkRow(page, JOB.title);
      await expect(row.getByTestId('link-open')).toHaveText(JOB.title);
      await expect(row.getByTestId('note-title')).toHaveCount(0);
    });

    await test.step('Oferta que no se pudo leer', async () => {
      await seedFailedRead(COMPUTRABAJO_URL, 'timeout');
      await page.reload();

      const row = linkRow(page, COMPUTRABAJO_LABEL);
      await expect(row.getByTestId('link-status')).toHaveText('No pudimos leer esta oferta');
      await expect(row.getByTestId('link-complete')).toBeVisible();
      await expect(row.getByTestId('link-retry')).toBeVisible();
      await page.screenshot({ path: join(ENRICHMENT_SCREENSHOT_DIR, 'oferta-sin-leer.png'), fullPage: true });
    });

    await test.step('Reintento aceptado', async () => {
      const row = linkRow(page, COMPUTRABAJO_LABEL);
      await row.getByTestId('link-retry').click();

      // La API devolvió el link de vuelta en `pending` y sin motivo de fallo: ya no hay nada que reintentar.
      await expect(row.getByTestId('link-status')).toHaveText('Leyendo la oferta…');
      await expect(row.getByTestId('link-retry')).toHaveCount(0);
      await page.screenshot({ path: join(ENRICHMENT_SCREENSHOT_DIR, 'reintento-aceptado.png'), fullPage: true });
    });

    await test.step('Bolsa que no permite la lectura', async () => {
      await seedFailedRead(LINKEDIN_URL, 'robots_disallowed');
      await page.reload();

      const row = linkRow(page, LINKEDIN_LABEL);
      // La tarjeta dice qué hacer, no solo qué pasó: lo que la completa es el texto que la persona ya tiene delante.
      await expect(row.getByTestId('link-status')).toHaveText(BLOCKED_TEXT);
      // Pegar es la acción principal, a la vista y sin abrir ningún menú; completar a mano queda como alternativa.
      await expect(row.getByTestId('link-paste')).toBeVisible();
      await expect(row.getByTestId('link-paste')).toHaveText('Pegar la descripción');
      await expect(row.getByTestId('link-complete')).toBeVisible();
      // Volver a pedir lo que el sitio ya negó no cambiaría nada, así que ni se ofrece.
      await expect(row.getByTestId('link-retry')).toHaveCount(0);
      await page.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'bolsa-bloqueada.png'), fullPage: true });
    });

    await test.step('another member joins the group and watches the same list', async () => {
      const inviteCode = ((await page.getByTestId('invite-code').textContent()) ?? '').trim();
      expect(inviteCode).not.toBe('');

      await member.goto('/registro');
      await register(member, MEMBER);
      await expect(member).toHaveURL(/\/grupos$/);
      await member.goto(`/unirse?codigo=${inviteCode}`);
      await member.getByRole('dialog').getByRole('button', { name: 'Unirme' }).click();

      await expect(member).toHaveURL(groupUrl);
      await expect(linkRow(member, LINKEDIN_LABEL).getByTestId('link-status')).toHaveText(
        BLOCKED_TEXT,
      );
    });

    await test.step('Oferta de LinkedIn completada pegando su texto', async () => {
      await linkRow(page, LINKEDIN_LABEL).getByTestId('link-paste').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('paste-text').fill(PASTED_FROM_CHAT.text);
      await expect(dialog.getByTestId('paste-counter')).toContainText(
        `${PASTED_FROM_CHAT.text.length} /`,
      );
      await page.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'dialogo-pegar.png'), fullPage: true });

      await dialog.getByTestId('paste-submit').click();

      // Sin recargar: la respuesta del pegado actualiza la tarjeta.
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const row = linkRow(page, CHAT_JOB.title);
      await expect(row.getByTestId('link-open')).toHaveText(CHAT_JOB.title);
      await expect(row.getByTestId('link-company')).toContainText(CHAT_JOB.company);
      await expect(row.getByTestId('link-location')).toHaveText(CHAT_JOB.location);
      await expect(row.getByTestId('link-modality')).toHaveText('Presencial');
      // Cada campo dice que salió del texto que pegó esta persona.
      const pastedBy = `Descripción pegada por ${USER.displayName}`;
      await expect(row.getByTestId('note-title')).toHaveText(pastedBy);
      await expect(row.getByTestId('note-company')).toHaveText(pastedBy);
      await expect(row.getByTestId('note-location')).toHaveText(pastedBy);
      // Con título y empresa la oferta ya se explica sola.
      await expect(row.getByTestId('link-status')).toHaveCount(0);
      await expect(row.getByTestId('link-undo-paste')).toHaveText(
        `Deshacer lo que pegó ${USER.displayName}`,
      );
      await page.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'oferta-pegada.png'), fullPage: true });
    });

    await test.step('Lo que pega otro miembro también llega', async () => {
      // El otro miembro no recarga: lo pegado le llega por el canal de avisos.
      const row = linkRow(member, CHAT_JOB.title);
      await expect(row.getByTestId('link-open')).toHaveText(CHAT_JOB.title);
      await expect(row.getByTestId('note-title')).toHaveText(
        `Descripción pegada por ${USER.displayName}`,
      );
      await member.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'otro-miembro.png'), fullPage: true });
    });

    await test.step('Lo pegado se distingue', async () => {
      await linkRow(page, CHAT_JOB.title).getByTestId('link-edit').click();
      const dialog = page.getByRole('dialog');

      await expect(dialog.getByTestId('origin-company')).toHaveText(
        `Descripción pegada por ${USER.displayName}`,
      );
      await page.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'origen-pegado.png'), fullPage: true });
      await dialog.getByRole('button', { name: 'Cancelar' }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
    });

    await test.step('Deshacer deja el estado que corresponde', async () => {
      await linkRow(page, CHAT_JOB.title).getByTestId('link-undo-paste').click();

      // Todo el pegado se deshace de una vez, y el link vuelve a estar bloqueado, no "escrito a mano".
      const row = linkRow(page, LINKEDIN_LABEL);
      await expect(row.getByTestId('link-status')).toHaveText(BLOCKED_TEXT);
      await expect(row.getByTestId('link-paste')).toBeVisible();
      await expect(row.getByTestId('link-retry')).toHaveCount(0);
      await expect(row.getByTestId('link-undo-paste')).toHaveCount(0);
      await expect(linkRow(page, CHAT_JOB.title)).toHaveCount(0);
      await page.screenshot({ path: join(PASTE_SCREENSHOT_DIR, 'pegado-deshecho.png'), fullPage: true });

      // Lo que deshace uno también lo ve el otro, sin recargar.
      await expect(linkRow(member, LINKEDIN_LABEL).getByTestId('link-status')).toHaveText(
        BLOCKED_TEXT,
      );
    });

    await test.step('Completar una oferta de LinkedIn', async () => {
      await saveLink(page, LINKEDIN_TYPED_URL);
      await expect(linkRow(page, LINKEDIN_TYPED_LABEL)).toHaveCount(1);
      await seedFailedRead(LINKEDIN_TYPED_URL, 'robots_disallowed');
      await page.reload();

      await linkRow(page, LINKEDIN_TYPED_LABEL).getByTestId('link-paste').click();
      const dialog = page.getByRole('dialog');
      await dialog.getByTestId('paste-text').fill(PASTED_FROM_APP.text);
      // Lo que se ve arriba de la oferta en la app y el texto copiado no trae.
      const title = PASTED_FROM_APP.knownTitle ?? '';
      const company = PASTED_FROM_APP.knownCompany ?? '';
      await dialog.getByTestId('paste-title').fill(title);
      await dialog.getByTestId('paste-company').fill(company);
      await dialog.getByTestId('paste-submit').click();

      await expect(page.getByRole('dialog')).toHaveCount(0);
      const row = linkRow(page, title);
      await expect(row.getByTestId('link-open')).toHaveText(title);
      await expect(row.getByTestId('link-company')).toContainText(company);
      // El título y la empresa los escribió la persona; lo demás salió de la descripción que pegó.
      await expect(row.getByTestId('note-title')).toHaveText(`Escrito por ${USER.displayName}`);
      await expect(row.getByTestId('note-location')).toHaveText(
        `Descripción pegada por ${USER.displayName}`,
      );
      await expect(row.getByTestId('link-modality')).toHaveText('Presencial');
      await expect(row.getByTestId('link-status')).toHaveCount(0);
      await page.screenshot({
        path: join(PASTE_SCREENSHOT_DIR, 'titulo-escrito-aparte.png'),
        fullPage: true,
      });
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await memberContext.close();
    await context.close();
  }
});
