import { workspaceRoot } from '@nx/devkit';
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { resetRegisterLimit } from './support/register-limit';

/**
 * Smoke de la sección BYOK del perfil (spec `web/byok`).
 *
 * QUÉ AFIRMA ESTE SPOKE SOBRE LOS AVISOS, Y POR QUÉ ASÍ. Los dos avisos condicionales —la nota de
 * `data_collection` y el de indisponibilidad del vendor— dependen de la configuración de la instancia contra la
 * que corre el smoke, así que aquí **no** se afirma que exista un vendor caído ni que exista uno con modelo de
 * pago: se afirma la **correspondencia** entre lo que enseña la pantalla y lo que dice el cuerpo de
 * `GET /api/users/me/ai-keys`. Eso es comprobable en cualquier configuración, y es justo la propiedad que el
 * change persigue: que la UI consuma la señal del servidor en vez de deducirla.
 *
 * CÓMO SE FABRICA LA PASADA DEL VENDOR INDISPONIBLE. El estado indisponible es un invariante del código, no un
 * ajuste de entorno, y en local hay **dos** fuentes que reponen un modelo utilizable. Hay que neutralizar **las dos**:
 *
 * - **El valor por defecto del código.** Vaciar `BYOK_OPENROUTER_MODEL` en el entorno no sirve: `EnvReader` lee la
 *   cadena vacía como ausente y `parse-ai-config.ts` repone `AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL`, que hoy es un
 *   modelo `:free` vivo.
 * - **El `.env` local.** Fija `BYOK_OPENROUTER_MODEL=<modelo>:free` y Nx lo inyecta al servir la `api`, **pisando**
 *   el valor por defecto del código. Con solo la neutralización del código el vendor sigue disponible.
 *
 * Receta —romper, mirar, restaurar, como el resto del change—:
 *
 *   1. en `libs/ai/src/infrastructure/config/ai-config.schema.ts`, poner `BYOK_OPENROUTER_MODEL: ''`;
 *   2. en el `.env` local, **comentar** la línea `BYOK_OPENROUTER_MODEL=...` (copiar antes su valor exacto);
 *   3. arrancar la `api` aparte (`pnpm nx serve api`; `playwright.config.mts` solo levanta `nx serve web`) y
 *      comprobar que su arranque dice
 *      `AI configuration warnings: BYOK_OPENROUTER_MODEL (unusable: BYOK vendor openrouter has no usable model: ...)`.
 *      Si ese aviso no sale, la neutralización no ha surtido efecto y correr el spec no prueba nada: no sigas;
 *   4. borrar `reports/smoke/ai-byok/perfil-byok-vendor-indisponible.png` si existe, y correr este spec;
 *   5. **restaurar los dos**: el esquema idéntico a HEAD (`git diff` vacío sobre ese fichero) y la línea exacta del
 *      `.env`, que está ignorado por git y ningún `git diff` va a delatar.
 *
 * CÓMO DISTINGUIR LA RAMA EJECUTADA DE LA SALTADA. Sin la neutralización —o con solo una de las dos mitades— el
 * bloque final **se salta y el test pasa igual**: un `1 passed` no dice nada del vendor indisponible. La rama corrió
 * solo si se dan **las dos** señales: (a) el aviso de configuración del paso 3 en el arranque de la `api`, y (b) la
 * captura `reports/smoke/ai-byok/perfil-byok-vendor-indisponible.png` **escrita en esta corrida** (por eso el paso 4
 * la borra antes). Si falta cualquiera de las dos, la pasada del vendor indisponible no se ha hecho, aunque el
 * reporter diga `ok`. El test deja además una anotación `skip-reason` al saltarse, pero el reporter de lista no la
 * imprime.
 *
 * Con la neutralización completa, el bloque final comprueba el aviso de indisponibilidad, que la clave guardada se
 * sigue anunciando como guardada, que la nota de `data_collection` NO aparece y que, con el permiso apagado y una
 * clave guardada de ese vendor, el aviso de clave inactiva **no** sale para él (`4dca9e3`: el aviso es por vendor
 * y no puede hablar de uno que no se va a usar) mientras sí sigue saliendo para OpenAI.
 */

interface AiKeysBody {
  keys: { vendor: string; keyHint: string; available: boolean }[];
  vendors: { vendor: string; available: boolean }[];
}

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'ai-byok');
const RUN_ID = Date.now();
const EMAIL = `smoke-byok+${RUN_ID}@example.com`;
const DISPLAY_NAME = 'Smoke Byok';
const PASSWORD = `Byok-pass-${RUN_ID}`;
const LIVE = 20_000;

test.beforeAll(() => {
  resetRegisterLimit();
});

test('BYOK profile: notices, save OpenAI hint, consent-off copy', async ({ page }) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/registro');
  await page.getByLabel('Nombre', { exact: true }).fill(DISPLAY_NAME);
  await page.getByLabel('Email', { exact: true }).fill(EMAIL);
  await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/grupos$/, { timeout: LIVE });

  const listed = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      new URL(response.url()).pathname === '/api/users/me/ai-keys' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.locator('mat-toolbar').getByRole('link', { name: 'Perfil' }).click();
  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByTestId('profile-byok')).toBeVisible({ timeout: LIVE });
  await expect(page.getByTestId('profile-byok-destination-openai')).toBeVisible();

  // La expectativa se deriva del cuerpo del API, no de la configuración que este smoke suponga.
  const listBody = (await (await listed).json()) as AiKeysBody;
  expect(listBody.vendors).toHaveLength(3);
  for (const { vendor, available } of listBody.vendors) {
    // El aviso de destino sale para todos, esté o no disponible el vendor.
    await expect(page.getByTestId(`profile-byok-destination-${vendor}`)).toBeVisible();
    const unavailable = page.getByTestId(`profile-byok-unavailable-${vendor}`);
    if (available) {
      await expect(unavailable, `${vendor} es construible y no puede decir que no lo está`).toHaveCount(0);
    } else {
      await expect(unavailable, `${vendor} no es construible y tiene que decirlo`).toBeVisible();
    }
  }

  // «no forzamos data_collection: deny» describe un envío que SÍ ocurre: solo con el vendor disponible.
  const openrouterAvailable =
    listBody.vendors.find((entry) => entry.vendor === 'openrouter')?.available === true;
  const dataCollection = page.getByTestId('profile-byok-openrouter-data-collection');
  if (openrouterAvailable) {
    await expect(dataCollection).toBeVisible();
  } else {
    await expect(
      dataCollection,
      'OpenRouter no es construible: ese aviso afirmaría un envío que no va a ocurrir',
    ).toHaveCount(0);
  }
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil-byok-vacio.png'), fullPage: true });

  const patchedConsent = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/users/me' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-ai-consent').locator('button').click();
  await patchedConsent;

  await page.getByTestId('profile-byok-key-openai').fill('sk-smoke-openai-key-123456');
  const putWait = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).pathname === '/api/users/me/ai-keys/openai' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-byok-save-openai').click();
  const put = await putWait;
  const body = (await put.json()) as { keyHint?: string; vendor?: string };
  expect(body.vendor).toBe('openai');
  expect(body.keyHint?.length).toBe(4);
  expect(JSON.stringify(body)).not.toContain('sk-smoke-openai-key-123456');
  await expect(page.getByTestId('profile-byok-hint-openai')).toContainText(body.keyHint!, {
    timeout: LIVE,
  });
  await page.screenshot({ path: join(SCREENSHOT_DIR, 'perfil-byok-openai.png'), fullPage: true });

  const revoked = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === '/api/users/me' &&
      response.ok(),
    { timeout: LIVE },
  );
  await page.getByTestId('profile-ai-consent').locator('button').click();
  await revoked;
  await expect(page.getByTestId('profile-byok-consent-off-openai')).toBeVisible({ timeout: LIVE });
  await page.screenshot({
    path: join(SCREENSHOT_DIR, 'perfil-byok-consent-off.png'),
    fullPage: true,
  });

  // Vendor sin configuración utilizable. Solo corre con la neutralización descrita en la cabecera: el estado es
  // un invariante del código y no se alcanza por entorno, así que sin ella no hay ningún vendor caído que mirar.
  const down = listBody.vendors.find((entry) => !entry.available);
  if (down === undefined) {
    test.info().annotations.push({
      type: 'skip-reason',
      description:
        'Todos los vendors son construibles en esta instancia: el caso indisponible exige neutralizar a mano AI_CONFIG_DEFAULTS.BYOK_OPENROUTER_MODEL (ver cabecera).',
    });
  } else {
    const notice = page.getByTestId(`profile-byok-unavailable-${down.vendor}`);
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toContainText('no está disponible ahora mismo');
    await expect(notice).toContainText('sigue guardada y cifrada');
    await expect(notice).toContainText('No se usará para ninguna tarea');
    await expect(notice).toContainText('otro de los proveedores soportados');
    await expect(page.getByTestId('profile-byok-openrouter-data-collection')).toHaveCount(0);

    // La clave de ese vendor se guarda igual y se sigue anunciando como guardada.
    const savedKey = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === `/api/users/me/ai-keys/${down.vendor}` &&
        response.ok(),
      { timeout: LIVE },
    );
    await page.getByTestId(`profile-byok-key-${down.vendor}`).fill('sk-smoke-down-key-123456');
    await page.getByTestId(`profile-byok-save-${down.vendor}`).click();
    const saved = (await savedKey).json() as Promise<{ keyHint?: string }>;
    const hint = (await saved).keyHint;
    await expect(page.getByTestId(`profile-byok-status-${down.vendor}`)).toContainText(
      'Configurada',
      { timeout: LIVE },
    );
    await expect(page.getByTestId(`profile-byok-hint-${down.vendor}`)).toContainText(hint!, {
      timeout: LIVE,
    });
    await expect(notice).toBeVisible();
    await expect(page.getByTestId('profile-byok-openrouter-data-collection')).toHaveCount(0);
    // Permiso apagado y clave guardada de este vendor: el aviso de clave inactiva no puede salir para él, porque
    // afirmaría que la clave se usaría al reactivar el permiso. El de OpenAI sí sigue: el aviso no ha desaparecido
    // por otra causa (permiso encendido, sección sin pintar), así que la ausencia de abajo significa algo.
    await expect(page.getByTestId('profile-byok-consent-off-openai')).toBeVisible();
    await expect(
      page.getByTestId(`profile-byok-consent-off-${down.vendor}`),
      `${down.vendor} no es construible: su clave no se usaría ni con el permiso encendido`,
    ).toHaveCount(0);
    await page.screenshot({
      path: join(SCREENSHOT_DIR, 'perfil-byok-vendor-indisponible.png'),
      fullPage: true,
    });
  }

  expect(pageErrors).toEqual([]);
});
