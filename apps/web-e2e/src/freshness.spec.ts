import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { MongoClient } from 'mongodb';
import { join } from 'node:path';
import { JOB_ID_SLOTS, jobIdBase } from './support/job-ids';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'job-link-freshness');
const MONGO_URI =
  process.env['MONGO_URI'] ?? 'mongodb://localhost:27017/linkvault?directConnection=true';

const RUN_ID = Date.now();
const JOB_ID = jobIdBase(JOB_ID_SLOTS.freshness);
const EMAIL = `smoke-freshness+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Freshness';
const PASSWORD = `Fresh-pass-${RUN_ID}`;
const LIVE = 20_000;

const PRIVATE_URL = `https://www.getonbrd.com/jobs/programming/freshness-smoke-${JOB_ID}`;
const PRIVATE_LABEL = `freshness smoke ${JOB_ID}`;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('job-link-freshness: closedAt badge on /mis-links', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  await page.goto('/mis-links');
  await expect(page).toHaveURL(/\/mis-links$/, { timeout: LIVE });
  await page.getByLabel('Pega el enlace de una oferta').fill(PRIVATE_URL);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.locator('li').filter({ hasText: PRIVATE_LABEL })).toBeVisible({
    timeout: LIVE,
  });

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const closedAt = new Date('2026-09-22T12:00:00.000Z');
    const at = closedAt.toISOString();
    const title = `Freshness closed ${JOB_ID}`;
    const company = 'Acme Smoke';
    const written = await client
      .db()
      .collection('job_links')
      .updateOne(
        { displayUrl: PRIVATE_URL },
        {
          $set: {
            closedAt,
            closedReason: 'calendar',
            previewStatus: 'enriched',
            preview: {
              title,
              company,
              location: null,
              modality: 'unknown',
              seniority: null,
              salary: null,
              postedAt: null,
              expiresAt: '2026-09-01',
              summary: null,
              skills: [],
              languages: [],
            },
            previewSources: {
              title: { value: title, source: 'auto', extractor: 'json-ld', at },
              company: { value: company, source: 'auto', extractor: 'json-ld', at },
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

  await page.reload();
  await expect(page).toHaveURL(/\/mis-links$/, { timeout: LIVE });
  const row = page.locator('li').filter({ hasText: `Freshness closed ${JOB_ID}` });
  await expect(row).toBeVisible({ timeout: LIVE });
  await expect(row.getByTestId('link-closed')).toBeVisible();
  await expect(row.getByTestId('link-closed')).toHaveText(/Oferta cerrada|Closed offer/);
  await expect(row.getByText('Acme Smoke')).toBeVisible();

  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'mis-links-oferta-cerrada.png'),
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
