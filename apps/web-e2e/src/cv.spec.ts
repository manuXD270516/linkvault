import { workspaceRoot } from '@nx/devkit';
import { type Locator, type Page, type Response, expect, test } from '@playwright/test';
import { crc32 } from 'node:zlib';
import { join } from 'node:path';
import { minimalPdf } from './support/cv-files';
import { resetRegisterLimit } from './support/register-limit';

const SCREENSHOT_DIR = join(workspaceRoot, 'reports', 'smoke', 'cv-upload-extract');

// **No hace falta franja nueva en `support/job-ids.ts`**: este spec no guarda ninguna oferta, así que no puede chocar
// con la deduplicación por `platform:externalJobId` de ningún otro spec (tarea 9.1).

const RUN_ID = Date.now();
/** Dueña del CV: es la única persona de este recorrido, porque un CV no se comparte con nadie. */
const ANA = {
  displayName: 'Smoke Ana',
  email: `smoke-cv+${RUN_ID}@example.com`,
  password: `Cv-pass-${RUN_ID}`,
};

/**
 * Marca propia de esta ejecución. Va dentro de los dos archivos y es lo que se busca en la vista previa: así se
 * comprueba que el texto que se enseña salió **de este** archivo y no de otro guardado antes.
 */
const MARKER = `smoke-cv-${RUN_ID}`;

/** Espera de lo que depende de datos: la lista recién pedida, la subida o la vista previa. */
const LIVE_TIMEOUT = 15_000;
/**
 * Espera de la lectura del CV, que hace el worker de verdad (cola `extract-cv`). Se espera **a la respuesta del
 * listado que ya dice `extracted`**, nunca con una pausa fija; el tope cubre el arranque en frío del worker y no
 * pasa de la ventana de sondeo del SPA (60 s), que es lo que deja de pedir la lista.
 */
const EXTRACTION_TIMEOUT = 60_000;

/**
 * Texto de los CV de prueba. **Inventado y sin ningún dato personal**: no hay nombres de personas reales, ni teléfonos,
 * ni direcciones, ni correos. Tiene que pasar de `CV_MIN_TEXT_CHARS` (100 caracteres) para que la lectura termine en
 * `extracted`, que es justo lo que este recorrido comprueba.
 */
const CV_LINES = [
  'Perfil profesional de prueba para el smoke de LinkVault',
  'Experiencia: desarrollo backend con Node, NestJS y PostgreSQL',
  'Tambien trabajo con MongoDB, Redis y colas de trabajos',
  'Formacion: ingenieria de sistemas, promocion de dos mil veinte',
  'Idiomas: espanol nativo e ingles intermedio',
  `Identificador de esta ejecucion: ${MARKER}`,
  // Relleno inventado hasta pasar de 8 kB, por dos razones. La primera es que un CV real pesa mucho más que un par de
  // párrafos. La segunda es un detalle de `pdf-parse`: un PDF de menos de 4 kB entra en el *pool* de `Buffer` de Node
  // y llega al parser como una vista con `byteOffset` distinto de cero, y entonces las posiciones de su tabla `xref`
  // se leen desplazadas y **cualquier** PDF así falla con "bad XRef entry" (comprobado con el mismo `pdf-parse` que
  // usa el worker). Con un archivo de este tamaño el `Buffer` ya tiene su propia memoria y el problema no aparece.
  ...Array.from(
    { length: 90 },
    (_, index) =>
      `Proyecto ${index + 1}: servicio de prueba con su API, su cola de trabajos y sus tests automatizados`,
  ),
];

/**
 * Un DOCX mínimo: un ZIP **sin comprimir** con las tres partes que Word exige. Sin compresión no hace falta ninguna
 * dependencia nueva, solo el `crc32` de `node:zlib`.
 */
function minimalDocx(lines: readonly string[]): Buffer {
  const paragraphs = lines
    .map((line) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(line)}</w:t></w:r></w:p>`)
    .join('');
  return storedZip([
    {
      name: '[Content_Types].xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'word/document.xml',
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
        `<w:body>${paragraphs}</w:body></w:document>`,
    },
  ]);
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** ZIP con entradas guardadas tal cual (método 0), que es todo lo que un DOCX necesita para poder abrirse. */
function storedZip(entries: readonly { name: string; content: string }[]): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const checksum = crc32(data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x0403_4b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x0201_4b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(data.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + data.length;
  }

  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x0605_4b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const PDF_CV = {
  name: `cv-smoke-${RUN_ID}.pdf`,
  mimeType: 'application/pdf',
  buffer: minimalPdf(CV_LINES),
};
const DOCX_CV = {
  name: `cv-smoke-${RUN_ID}.docx`,
  mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  buffer: minimalDocx(CV_LINES),
};

async function register(
  page: Page,
  user: { displayName: string; email: string; password: string },
): Promise<void> {
  // El límite de registros por IP (10 cada 15 min) es de toda la suite y los specs corren a la vez desde la misma
  // máquina: se vacía justo antes del alta para que un 429 de `auth` no haga fallar lo que se prueba aquí.
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

/** `true` cuando el listado ya trae ese CV leído: es la señal de que el worker terminó. */
async function listsExtracted(response: Response, fileName: string): Promise<boolean> {
  if (!isCvList(response)) {
    return false;
  }
  const body = (await response.json()) as { items?: { fileName: string; extraction: { status: string } }[] };
  return (body.items ?? []).some(
    (item) => item.fileName === fileName && item.extraction.status === 'extracted',
  );
}

/** Abre `/mi-cv` desde la barra y espera a la lista: sin ella, una comprobación de ausencia pasaría en vacío. */
async function openMyCv(page: Page): Promise<void> {
  const list = page.waitForResponse(isCvList, { timeout: LIVE_TIMEOUT });
  await page.getByRole('link', { name: 'Mi CV' }).click();
  await list;
  await expect(page).toHaveURL(/\/mi-cv$/);
}

/** Sube un archivo por el botón, que es la vía principal, y espera al `201` con el CV ya guardado. */
async function uploadCv(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<{ id: string; fileName: string; isDefault: boolean; extraction: { status: string } }> {
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
  return (await (await uploaded).json()) as {
    id: string;
    fileName: string;
    isDefault: boolean;
    extraction: { status: string };
  };
}

/** Tarjeta del CV con ese nombre de archivo. */
function cvCard(page: Page, fileName: string): Locator {
  return page.getByTestId('cv-card').filter({ hasText: fileName });
}

/** El diálogo que contiene ese componente: la vista previa y una confirmación pueden coincidir en pantalla. */
function dialogWith(page: Page, selector: string): Locator {
  return page.locator('mat-dialog-container').filter({ has: page.locator(selector) });
}

/**
 * La promesa está a la vista y no hay por dónde sacar el archivo. Las dos se comprueban en los dos recorridos, porque
 * las dos son decisiones del change y no detalles de una pantalla: la API no expone los bytes del CV (ADR-028 §5).
 */
async function expectPrivacyAndNoDownload(page: Page): Promise<void> {
  await expect(page.getByTestId('cv-privacy')).toHaveText(
    'Tu CV solo lo ves tú y no sale de LinkVault sin tu permiso. En Perfil decides si un proveedor de IA externo puede ' +
      'analizarlo: antes de enviárselo sustituimos tu email, tus teléfonos, tu dirección, tu documento de identidad y ' +
      'las URL por marcadores, y también tu nombre, salvo que lo desactives allí.',
  );
  const labels = await page.locator('lv-my-cv-page button, lv-my-cv-page a').allInnerTexts();
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label).not.toMatch(/descargar|download|compartir/i);
  }
  await expect(page.locator('lv-my-cv-page [download]')).toHaveCount(0);
}

test('my CV: upload it, watch it being read and look at what we read', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await test.step('9.1 Ana arrives at an empty screen that explains what her CV is for', async () => {
      await page.goto('/registro');
      await register(page, ANA);
      await expect(page).toHaveURL(/\/grupos$/);

      await openMyCv(page);

      await expect(page.getByTestId('cv-empty')).toHaveText(
        'Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante.',
      );
      await expect(page.getByTestId('cv-card')).toHaveCount(0);
      await expectPrivacyAndNoDownload(page);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'mi-cv.png'), fullPage: true });
    });

    await test.step('9.1 she uploads a PDF and sees it being read', async () => {
      const saved = await uploadCv(page, PDF_CV);
      expect(saved.fileName).toBe(PDF_CV.name);
      // Nace leyéndose y con la marca puesta: es el primero, no hay nada que elegir.
      expect(saved.extraction.status).toBe('pending');
      expect(saved.isDefault).toBe(true);

      const card = cvCard(page, PDF_CV.name);
      await expect(card).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(card.getByTestId('cv-status')).toHaveText('Estamos leyendo tu CV…');
      await expect(card.getByTestId('cv-default-line')).toHaveText(
        'Este es el CV que compararemos con las vacantes',
      );
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'leyendo.png'), fullPage: true });
    });

    await test.step('9.1 the worker reads it and the card says so without reloading', async () => {
      // Se espera a la respuesta del listado que ya lo trae leído: la extracción la hace el worker de verdad y su
      // duración no se puede suponer.
      await page.waitForResponse((response) => listsExtracted(response, PDF_CV.name), {
        timeout: EXTRACTION_TIMEOUT,
      });

      const card = cvCard(page, PDF_CV.name);
      await expect(card.getByTestId('cv-status')).toHaveText('Listo · tu CV se leyó bien', {
        timeout: LIVE_TIMEOUT,
      });
      // El recuento de caracteres no se enseña: lo que importa es ver el texto.
      await expect(card).not.toContainText('caracteres');
    });

    await test.step('9.1 "Ver lo que leímos" shows the text, and nothing to take it away', async () => {
      const preview = page.waitForResponse(
        (response) =>
          response.request().method() === 'GET' &&
          /^\/api\/cv\/[^/]+\/text-preview$/.test(new URL(response.url()).pathname) &&
          response.status() === 200,
        { timeout: LIVE_TIMEOUT },
      );
      await cvCard(page, PDF_CV.name).getByTestId('cv-view-text').click();
      await preview;

      const dialog = dialogWith(page, 'lv-cv-text-preview-dialog');
      await expect(dialog).toContainText(
        'Así leímos tu CV. Si ves el texto desordenado, vuelve a exportarlo desde tu editor y súbelo otra vez.',
      );
      // Sale texto, y es el de **este** archivo.
      await expect(dialog.getByTestId('cv-preview-text')).toContainText(MARKER, {
        timeout: LIVE_TIMEOUT,
      });
      // Ni copiar, ni descargar, ni compartir: la única acción es cerrar.
      expect(await dialog.getByRole('button').allInnerTexts()).toEqual(['Cerrar']);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'lo-que-leimos.png'), fullPage: true });

      await dialog.getByRole('button', { name: 'Cerrar' }).click();
      await expect(dialog).toHaveCount(0, { timeout: LIVE_TIMEOUT });
      // El texto no se queda en la pantalla al cerrar.
      await expect(page.getByTestId('cv-preview-text')).toHaveCount(0);
      await expectPrivacyAndNoDownload(page);
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('my CV: a second one takes the mark, she moves it back and deletes one', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const context = await browser.newContext();
  const pageErrors: string[] = [];

  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await test.step('9.2 Ana saves a first CV', async () => {
      await page.goto('/registro');
      await register(page, {
        ...ANA,
        email: `smoke-cv-second+${RUN_ID}@example.com`,
      });
      await expect(page).toHaveURL(/\/grupos$/);
      await openMyCv(page);

      const first = await uploadCv(page, PDF_CV);
      expect(first.isDefault).toBe(true);
      await expect(cvCard(page, PDF_CV.name)).toHaveCount(1, { timeout: LIVE_TIMEOUT });
    });

    await test.step('9.2 the second CV takes the mark, and it says what the mark is for', async () => {
      const second = await uploadCv(page, DOCX_CV);
      // Quien sube un CV nuevo lo sube porque es el bueno (D4): la marca se va con él.
      expect(second.isDefault).toBe(true);

      const cards = page.getByTestId('cv-card');
      await expect(cards).toHaveCount(2, { timeout: LIVE_TIMEOUT });
      // El más reciente va arriba.
      await expect(cards.first()).toContainText(DOCX_CV.name);
      await expect(cvCard(page, DOCX_CV.name).getByTestId('cv-default-line')).toHaveText(
        'Este es el CV que compararemos con las vacantes',
      );
      await expect(cvCard(page, PDF_CV.name).getByTestId('cv-default-line')).toHaveCount(0);
      await expectPrivacyAndNoDownload(page);
      await page.screenshot({ path: join(SCREENSHOT_DIR, 'dos-cv.png'), fullPage: true });
    });

    await test.step('9.2 she moves the mark back to the first one, with no confirmation', async () => {
      const marked = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          /^\/api\/cv\/[^/]+\/default$/.test(new URL(response.url()).pathname) &&
          response.status() === 200,
        { timeout: LIVE_TIMEOUT },
      );
      await cvCard(page, PDF_CV.name).getByTestId('cv-use-this').click();
      // Mover la marca no destruye nada, así que no hay confirmación que responder.
      await marked;

      await expect(cvCard(page, PDF_CV.name).getByTestId('cv-default-line')).toHaveText(
        'Este es el CV que compararemos con las vacantes',
        { timeout: LIVE_TIMEOUT },
      );
      await expect(cvCard(page, DOCX_CV.name).getByTestId('cv-default-line')).toHaveCount(0);
      // Y el que ya la tiene no ofrece "Usar este".
      await expect(cvCard(page, PDF_CV.name).getByTestId('cv-use-this')).toHaveCount(0);
    });

    await test.step('9.2 she deletes the second one after a confirmation that names the file', async () => {
      const deleted = page.waitForResponse(
        (response) =>
          response.request().method() === 'DELETE' &&
          /^\/api\/cv\/[^/]+$/.test(new URL(response.url()).pathname) &&
          response.status() === 200,
        { timeout: LIVE_TIMEOUT },
      );
      await cvCard(page, DOCX_CV.name).getByTestId('cv-remove').click();

      const confirmation = dialogWith(page, 'lv-confirm-dialog');
      await expect(confirmation).toContainText(DOCX_CV.name);
      await expect(confirmation).toContainText('El archivo se borra y no se puede recuperar.');
      // No es el marcado, así que no se avisa de ninguna promoción.
      await expect(confirmation).not.toContainText('Pasará a usarse tu CV más reciente');
      await confirmation.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await deleted;

      await expect(page.getByTestId('cv-card')).toHaveCount(1, { timeout: LIVE_TIMEOUT });
      await expect(cvCard(page, DOCX_CV.name)).toHaveCount(0);
      await expect(cvCard(page, PDF_CV.name).getByTestId('cv-default-line')).toHaveText(
        'Este es el CV que compararemos con las vacantes',
      );
      await expectPrivacyAndNoDownload(page);
    });

    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
