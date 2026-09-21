import { workspaceRoot } from '@nx/devkit';
import { type Locator, type Page, type Response, expect, test } from '@playwright/test';
import { MongoClient, ObjectId } from 'mongodb';
import { join } from 'node:path';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'cv-match-suggestions');

/**
 * Base de `api`, para escribir en `job_links` / `cv_documents` lo que el worker habría dejado listo para el análisis.
 * Es el mismo valor por defecto de `.env.example`; con un `.env` propio, Nx lo pasa en `MONGO_URI` y manda ese.
 */
const MONGO_URI =
  process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/linkvault?directConnection=true';

const RUN_ID = Date.now();
/** Id de oferta de este spec: único aunque otro spec arranque en el mismo milisegundo. */
const JOB_ID = jobIdBase(JOB_ID_SLOTS.match);
const ANA = {
  displayName: 'Smoke Ana Encaje',
  email: `smoke-match+${RUN_ID}@example.com`,
  password: `Match-pass-${RUN_ID}`,
};
const GROUP_NAME = `Smoke Encaje ${RUN_ID}`;

/** Oferta de LinkedIn: el worker no la lee (`robots.txt`); la descripción la dejamos sembrada. */
const OFFER_URL = `https://www.linkedin.com/jobs/view/backend-nestjs-senior-${JOB_ID}/`;
const OFFER_LABEL = `backend nestjs senior ${JOB_ID}`;

/**
 * Texto del CV y de la oferta: clave fija del fixture handwritten de `match-cv`
 * (`ce41cbcd5034386fd912920e88d4a18d1d2aadb75db2e1662927ce5de630c130`), con `AI_CHAIN=mock` y
 * `AI_MOCK_MODE=replay`. El PDF se sube de verdad; el texto extraído se fija después para que coincida
 * byte a byte con esa clave (la extracción real podría alterar saltos de línea).
 */
const MATCH_CV_TEXT = [
  'Perfil profesional de prueba para el smoke de encaje LinkVault',
  'Experiencia: desarrollo backend con Node.js y NestJS',
  'Formacion: ingenieria de sistemas',
  'Idiomas: espanol nativo e ingles intermedio',
  'Contacto: smoke.match@example.bo',
].join('\n');

const MATCH_JOB = {
  title: 'Backend NestJS Senior',
  summary:
    'Buscamos Node.js, TypeScript, NestJS, PostgreSQL, Redis, Kafka, Docker y Kubernetes.',
  skills: [
    { name: 'Node.js', required: true },
    { name: 'TypeScript', required: true },
    { name: 'NestJS', required: true },
    { name: 'PostgreSQL', required: true },
    { name: 'Redis', required: false },
    { name: 'Kafka', required: false },
    { name: 'Docker', required: false },
    { name: 'Kubernetes', required: false },
  ],
} as const;

/** Primeras cinco sugerencias del fixture; la sexta queda tras "Ver las 1 restantes". */
const FIRST_SUGGESTION_AFTER = 'Incluir experiencia con TypeScript en servicios NestJS.';
const SIXTH_SUGGESTION_AFTER = 'Incluir Kubernetes para orquestacion de servicios.';

const LIVE_TIMEOUT = 15_000;
const ANALYSIS_TIMEOUT = 60_000;

const CV_LINES = [
  ...MATCH_CV_TEXT.split('\n'),
  ...Array.from(
    { length: 90 },
    (_, index) =>
      `Proyecto ${index + 1}: servicio de prueba con su API, su cola de trabajos y sus tests automatizados`,
  ),
];

function minimalPdf(lines: readonly string[]): Buffer {
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    ...lines.flatMap((line) => [`(${escapePdfText(line)}) Tj`, '0 -16 Td']),
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const startxref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \r\n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \r\n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

function escapePdfText(line: string): string {
  return line.replace(/([\\()])/g, '\\$1');
}

const PDF_CV = {
  name: `cv-match-${RUN_ID}.pdf`,
  mimeType: 'application/pdf',
  buffer: minimalPdf(CV_LINES),
};

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string },
): Promise<void> {
  resetRegisterLimit();
  await page.getByLabel('Nombre', { exact: true }).fill(user.displayName);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(user.password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

function isCvList(response: Response): boolean {
  return (
    response.request().method() === 'GET' &&
    new URL(response.url()).pathname === '/api/cv' &&
    response.ok()
  );
}

async function openMyCv(page: Page): Promise<void> {
  const list = page.waitForResponse(isCvList, { timeout: LIVE_TIMEOUT });
  await page.getByRole('link', { name: 'Mi CV' }).click();
  await list;
  await expect(page).toHaveURL(/\/mi-cv$/);
}

async function uploadCv(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ id: string; fileName: string }> {
  const uploaded = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === '/api/cv' &&
      response.status() === 201,
    { timeout: LIVE_TIMEOUT },
  );
  const chooser = page.waitForEvent('filechooser');
  await page.getByTestId('cv-upload-button').click();
  await (await chooser).setFiles(file);
  return (await (await uploaded).json()) as { id: string; fileName: string };
}

function cvCard(page: Page, fileName: string): Locator {
  return page.getByTestId('cv-card').filter({ hasText: fileName });
}

function dialogWith(page: Page, selector: string): Locator {
  return page.locator('mat-dialog-container').filter({ has: page.locator(selector) });
}

/** Fila de la oferta: tras sembrar el preview manda el título, no la etiqueta de la URL. */
function offerRow(page: Page, label: string = MATCH_JOB.title) {
  return page.locator('li').filter({ hasText: label });
}

function matchDialog(page: Page) {
  return dialogWith(page, 'lv-match-dialog');
}

/**
 * Deja el preview de la oferta listo para analizar: título, resumen y skills del fixture de `match-cv`.
 * Doble del pegado/enriquecimiento: el worker no lee LinkedIn.
 */
async function seedJobForMatch(displayUrl: string): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const written = await client
      .db()
      .collection('job_links')
      .updateOne(
        { displayUrl },
        {
          $set: {
            previewStatus: 'enriched',
            preview: {
              title: MATCH_JOB.title,
              summary: MATCH_JOB.summary,
              skills: MATCH_JOB.skills.map((skill) => ({ ...skill })),
            },
            updatedAt: new Date(),
          },
          $inc: { previewVersion: 1 },
        },
      );
    expect(written.matchedCount).toBe(1);
  } finally {
    await client.close();
  }
}

/** Fija el texto extraído al del fixture, sin depender de cómo `pdf-parse` une las líneas. */
async function seedCvText(cvId: string): Promise<void> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const written = await client
      .db()
      .collection('cv_documents')
      .updateOne(
        { _id: new ObjectId(cvId) },
        {
          $set: {
            extractedText: MATCH_CV_TEXT,
            truncated: false,
            'extraction.status': 'extracted',
            'extraction.textChars': [...MATCH_CV_TEXT].length,
            'extraction.extractedAt': new Date(),
            updatedAt: new Date(),
          },
          $unset: { 'extraction.failureReason': '' },
        },
      );
    expect(written.matchedCount).toBe(1);
  } finally {
    await client.close();
  }
}

async function createGroupAndOffer(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Crear un grupo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(GROUP_NAME);
  await dialog.getByRole('button', { name: 'Crear grupo' }).click();
  await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
  const groupUrl = page.url();

  await page.getByLabel('Pega el enlace de una oferta').fill(OFFER_URL);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(offerRow(page, OFFER_LABEL)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
  await seedJobForMatch(OFFER_URL);
  await page.reload();
  await expect(offerRow(page).getByTestId('link-open')).toHaveText(MATCH_JOB.title, {
    timeout: LIVE_TIMEOUT,
  });
  return groupUrl;
}

async function prepareCv(page: Page): Promise<string> {
  await openMyCv(page);
  const saved = await uploadCv(page, PDF_CV);
  expect(saved.fileName).toBe(PDF_CV.name);
  // Esperar a que el worker termine (o falle) y entonces fijar el texto del fixture: si se siembra antes,
  // la extracción puede pisar el texto y romper la clave de replay.
  await page.waitForResponse(
    async (response) => {
      if (!isCvList(response)) return false;
      const body = (await response.json()) as {
        items?: { id: string; extraction: { status: string } }[];
      };
      const item = (body.items ?? []).find((entry) => entry.id === saved.id);
      return (
        item !== undefined &&
        (item.extraction.status === 'extracted' || item.extraction.status === 'failed')
      );
    },
    { timeout: 60_000 },
  ).catch(() => undefined);
  await seedCvText(saved.id);
  const list = page.waitForResponse(isCvList, { timeout: LIVE_TIMEOUT });
  await page.reload();
  await list;
  await expect(cvCard(page, PDF_CV.name).getByTestId('cv-status')).toHaveText(
    'Listo · tu CV se leyó bien',
    { timeout: LIVE_TIMEOUT },
  );
  return saved.id;
}

test('match flow: analyze from the card, see steps, report, suggestions and copy', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let groupUrl = '';
    let matchPosts = 0;
    page.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        /\/api\/links\/[^/]+\/match$/.test(new URL(request.url()).pathname)
      ) {
        matchPosts += 1;
      }
    });

    await test.step('17.1 Ana registers, uploads a CV and saves a job with its description', async () => {
      await page.goto('/registro');
      await register(page, ANA);
      await expect(page).toHaveURL(/\/grupos$/);
      await prepareCv(page);
      await page.goto('/grupos');
      await expect(page).toHaveURL(/\/grupos$/);
      groupUrl = await createGroupAndOffer(page);
      expect(groupUrl).not.toBe('');
    });

    await test.step('17.1 opening the dialog does not request an analysis', async () => {
      matchPosts = 0;
      await offerRow(page).getByTestId('link-analyze-match').click();
      const dialog = matchDialog(page);
      await expect(dialog).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(dialog.getByTestId('match-job-title')).toHaveText(MATCH_JOB.title);
      await expect(dialog.getByTestId('match-analyze')).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(dialog.getByTestId('match-steps')).toHaveCount(0);
      await expect(dialog.getByTestId('match-badge')).toHaveCount(0);
      expect(matchPosts).toBe(0);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'dialogo-sin-pedir.png'), fullPage: true });
    });

    await test.step('17.1 Analizar shows progress steps then the report with suggestions', async () => {
      const dialog = matchDialog(page);
      const posted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/links\/[^/]+\/match$/.test(new URL(response.url()).pathname) &&
          response.status() === 202,
        { timeout: LIVE_TIMEOUT },
      );
      await dialog.getByTestId('match-analyze').click();
      await posted;

      await expect(dialog.getByTestId('match-steps')).toBeVisible({ timeout: LIVE_TIMEOUT });
      await expect(dialog.locator('[data-step="reading-job"]')).toBeVisible({
        timeout: ANALYSIS_TIMEOUT,
      });

      await expect(dialog.getByTestId('match-badge')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
      await expect(dialog.getByTestId('match-badge-score')).toHaveText('42');
      await expect(dialog.getByTestId('match-suggestions')).toBeVisible();
      await expect(dialog.getByTestId('match-suggestion')).toHaveCount(5);
      await expect(dialog.getByTestId('match-suggestions-more')).toHaveText('Ver las 1 restantes');
      await expect(dialog.getByTestId('match-suggestion').first()).toContainText(
        FIRST_SUGGESTION_AFTER,
      );
      await expect(dialog.getByTestId('match-suggestion-job').first()).toHaveText('TypeScript');
      await expect(dialog.getByTestId('match-suggestion-cv-missing').first()).toBeVisible();
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'informe.png'), fullPage: true });
    });

    await test.step('17.1 expanding shows the rest and Copiar works', async () => {
      const dialog = matchDialog(page);
      await dialog.getByTestId('match-suggestions-more').click();
      await expect(dialog.getByTestId('match-suggestion')).toHaveCount(6);
      await expect(dialog.getByTestId('match-suggestions-more')).toHaveCount(0);
      await expect(dialog.getByTestId('match-suggestion').last()).toContainText(
        SIXTH_SUGGESTION_AFTER,
      );

      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await dialog.getByTestId('match-suggestion-copy').first().click();
      await expect(dialog.getByText('Copiado', { exact: true })).toBeVisible({
        timeout: LIVE_TIMEOUT,
      });
      const copied = await page.evaluate(() => navigator.clipboard.readText());
      expect(copied).toBe(FIRST_SUGGESTION_AFTER);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'sugerencias-copiar.png'), fullPage: true });

      await dialog.getByTestId('match-close').click();
      await expect(matchDialog(page)).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('match consent: grant on profile, see status on mi-cv, revoke and delete with analysis count', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await test.step('17.2 Ana prepares a CV, a job and one analysis', async () => {
      await page.goto('/registro');
      await register(page, {
        ...ANA,
        email: `smoke-match-consent+${RUN_ID}@example.com`,
      });
      await expect(page).toHaveURL(/\/grupos$/);
      await prepareCv(page);
      await page.goto('/grupos');
      await createGroupAndOffer(page);

      await offerRow(page).getByTestId('link-analyze-match').click();
      const dialog = matchDialog(page);
      await expect(dialog.getByTestId('match-analyze')).toBeVisible({ timeout: LIVE_TIMEOUT });
      const posted = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          /\/api\/links\/[^/]+\/match$/.test(new URL(response.url()).pathname) &&
          response.status() === 202,
        { timeout: LIVE_TIMEOUT },
      );
      await dialog.getByTestId('match-analyze').click();
      await posted;
      await expect(dialog.getByTestId('match-badge')).toBeVisible({ timeout: ANALYSIS_TIMEOUT });
      await dialog.getByTestId('match-close').click();
      await expect(matchDialog(page)).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    });

    await test.step('17.2 she grants consent on /perfil and sees date and version', async () => {
      await page.locator('mat-toolbar').getByRole('link', { name: 'Perfil' }).click();
      await expect(page).toHaveURL(/\/perfil$/);
      await expect(page.getByTestId('profile-ai-consent-text')).toBeVisible();

      const patched = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === '/api/users/me' &&
          response.ok(),
        { timeout: LIVE_TIMEOUT },
      );
      await page.getByTestId('profile-ai-consent').locator('button').click();
      await patched;

      const meta = page.getByTestId('profile-ai-consent-meta');
      await expect(meta).toContainText('Concedido el');
      await expect(meta).toContainText(AI_CONSENT_TEXT_VERSION);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'permiso-concedido.png'), fullPage: true });
    });

    await test.step('17.2 mi-cv shows the permission is active and what it implies', async () => {
      await openMyCv(page);
      await expect(page.getByTestId('cv-privacy-status')).toContainText(
        'Ahora mismo ese permiso está activo',
      );
      await expect(page.getByTestId('cv-privacy-status')).toContainText(
        'tu CV redactado sale de LinkVault hacia el proveedor externo',
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'mi-cv-permiso-activo.png'),
        fullPage: true,
      });
    });

    await test.step('17.2 she revokes and reads the full withdrawal message', async () => {
      // En /mi-cv hay otro enlace "Perfil" (aviso de privacidad); el de la barra es el canónico.
      await page.locator('mat-toolbar').getByRole('link', { name: 'Perfil' }).click();
      await expect(page).toHaveURL(/\/perfil$/);

      const patched = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === '/api/users/me' &&
          response.ok(),
        { timeout: LIVE_TIMEOUT },
      );
      await page.getByTestId('profile-ai-consent').locator('button').click();
      await patched;

      const revoked = page.getByTestId('profile-ai-consent-revoked');
      await expect(revoked).toHaveText(
        'Permiso retirado. Tus próximos análisis no saldrán de LinkVault. No borra los análisis que ya hiciste; para eso, elimina el CV con el que se hicieron. Lo que ya se envió a un proveedor externo no se puede recuperar.',
      );
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'permiso-retirado.png'), fullPage: true });
    });

    await test.step('17.2 deleting the CV names how many analyses it takes', async () => {
      await openMyCv(page);
      await cvCard(page, PDF_CV.name).getByTestId('cv-remove').click();
      const confirmation = dialogWith(page, 'lv-confirm-dialog');
      await expect(confirmation).toContainText(PDF_CV.name);
      await expect(confirmation).toContainText(
        'También se borrarán los 1 análisis de encaje que hiciste con este CV.',
      );
      await page.screenshot({
        path: join(SCREENSHOT_DIR, 'borrar-cv-con-analisis.png'),
        fullPage: true,
      });
      await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await expect(page.getByTestId('cv-card')).toHaveCount(0, { timeout: LIVE_TIMEOUT });
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
