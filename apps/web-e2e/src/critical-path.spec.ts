import {
  groupDetailSchema,
  sessionResponseSchema,
  trackLinkResponseSchema,
  updatePreviewResponseSchema,
} from '@linkvault/shared';
import {
  type APIRequestContext,
  expect,
  type Locator,
  test,
  type Page,
  type Response,
  type TestInfo,
} from '@playwright/test';
import { type CriticalPathJob, readCriticalPathJob } from './support/critical-path-input';
import { Journey, type StepKey } from './support/journey';
import { type Profile, type ProfileName, resolveProfile } from './support/profile';
import {
  assertRemoteAccountGuards,
  describeSweep,
  type GuardedAccount,
  SUITE_PREFIX,
  sweepSuiteLeftovers,
} from './support/remote-account';
import { SuiteApi } from './support/suite-api';

/**
 * Lote 1: el camino crítico (change `e2e-suite`, design D11). **Una** prueba con un `test.step` por paso, todo por la
 * interfaz y sin escribir en Mongo, que se ejecuta con el runner (`web-e2e:e2e-stack`, perfil `local`) y contra un
 * destino remoto (`web-e2e:e2e-remote`, perfil `remote`).
 *
 * | # | Paso | `local` | `remote` |
 * |---|---|---|---|
 * | 0 | Entrar con la cuenta de prueba, guardias por la API, limpieza previa (D10) | — | sí |
 * | 1 | A se registra y aterriza en `/grupos` | sí | no aplicable (D10: sin altas en remoto) |
 * | 2 | A crea un grupo con la visibilidad pública por defecto apagada; detalle con «Propietario» y el código | sí | sí |
 * | 3 | A guarda en el grupo el link de una oferta en un dominio reservado (`.invalid`); la tarjeta aparece | sí | sí |
 * | 4 | A completa la oferta a mano con la entrada versionada (D7); «Escrito por …» | sí | sí |
 * | 5 | «Postulé» → «Hoy»; la tarjeta muestra la postulación y `/postulaciones` la tiene en «Postuladas» | sí | sí |
 *
 * Los pasos 2b y 6 a 8 los añaden las tareas 5.4, 5.7, 5.8 y 5.10, cada una con su línea en `DECLARED_STEPS`.
 *
 * En `remote`, lo que la prueba crea en la cuenta se borra al terminar en un `finally` (design D10, tarea 4.2), también
 * si falla, y solo si los guardias del paso 0 pasaron: un guardia que falla deja la cuenta como estaba.
 *
 * Sincronización (D11): cada paso arma **antes** de la acción la espera de la respuesta o de la navegación que provoca
 * y afirma con aserciones web-first. El paso 0 no afirma el texto del aviso de email (35b lo cambia): el estado del
 * email lo comprueba el guardia por la API.
 */

/** Pasos que ejecuta cada perfil, por persona. Lo que no está aquí es «no aplicable» en ese perfil. */
const DECLARED_STEPS: Readonly<Record<ProfileName, readonly StepKey[]>> = {
  local: ['A:1', 'A:2', 'A:3', 'A:4', 'A:5'],
  remote: ['A:0', 'A:2', 'A:3', 'A:4', 'A:5'],
};

/**
 * Techo de la espera a que la lectura automática de la oferta termine (en un dominio `.invalid` no puede prosperar): el
 * `worker` da una lectura por perdida a los `ENRICH_DEADLINE_MS` (45 s en `e2e.env`). Es un techo, no una espera.
 */
const ENRICHMENT_SETTLED_TIMEOUT = 60_000;

/** Alfabeto del código de invitación: base32 de Crockford sin `0`, `1`, `I`, `L`, `O` ni `U`. */
const INVITE_CODE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

interface Person {
  readonly displayName: string;
  readonly email: string;
  readonly password: string;
}

/**
 * Identificador de esta ejecución: distinto por proyecto (`chromium`, `mobile`), por repetición (`--repeat-each`) y por
 * reintento, para que ninguna alta choque con otra de la misma corrida (design D5).
 */
function runId(testInfo: TestInfo): string {
  return `${Date.now()}-${testInfo.project.name}-${testInfo.repeatEachIndex}-${testInfo.retry}`;
}

function isApiCall(method: string, path: RegExp): (response: Response) => boolean {
  return (response) => response.request().method() === method && path.test(new URL(response.url()).pathname);
}

/**
 * Paso 0 (`remote`): entrar con la cuenta de prueba declarada, guardias por la API (tarea 4.3a) y, solo después,
 * limpieza previa de lo que dejó una corrida interrumpida (tarea 4.2). La API se llama con el access token que devolvió
 * el login de la interfaz, y solo en el origen de la API del perfil (design D9).
 */
async function enterWithTestAccount(
  page: Page,
  request: APIRequestContext,
  profile: Profile,
  testInfo: TestInfo,
): Promise<GuardedAccount> {
  const account = profile.remoteAccount;
  if (account === undefined) {
    throw new Error('step 0 runs only in the remote profile, with its declared account');
  }
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  const login = page.waitForResponse(isApiCall('POST', /^\/api\/auth\/login$/));
  const landed = page.waitForURL(/\/grupos$/);
  await page.getByRole('button', { name: 'Entrar' }).click();
  const loginResponse = await login;
  expect(loginResponse.status()).toBe(200);
  const session = sessionResponseSchema.parse(await loginResponse.json());
  await landed;
  await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
  // Los guardias van antes que cualquier cambio en la cuenta, incluida la limpieza previa.
  const guarded = await assertRemoteAccountGuards(new SuiteApi(request, profile.apiOrigin, session.accessToken));
  const swept = await sweepSuiteLeftovers(guarded);
  testInfo.annotations.push({ type: 'sweep-start', description: describeSweep(swept) });
  return guarded;
}

/** Paso 1 (`local`): A se registra y aterriza en `/grupos`. */
async function register(page: Page, person: Person): Promise<void> {
  await page.goto('/registro');
  await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill(person.displayName);
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(person.password);
  const registered = page.waitForResponse(isApiCall('POST', /^\/api\/auth\/register$/));
  const landed = page.waitForURL(/\/grupos$/);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  expect((await registered).status()).toBe(201);
  await landed;
  await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
}

interface Entry {
  /** Nombre visible de A si la prueba lo conoce: en `remote` la cuenta la creó el autor y solo se tiene su email. */
  readonly ownerName: string | undefined;
  /** En `remote`, la cuenta cuyos guardias pasaron: la única que se limpia al terminar. */
  readonly guarded: GuardedAccount | undefined;
}

/** Entrada según el perfil: el paso 0 en `remote`, el 1 en `local` (D11). */
async function enter(
  journey: Journey,
  page: Page,
  request: APIRequestContext,
  profile: Profile,
  personA: Person,
  testInfo: TestInfo,
): Promise<Entry> {
  if (profile.name === 'remote') {
    let guarded: GuardedAccount | undefined;
    await journey.step('A', '0', 'enter with the declared test account, API guards, sweep of leftovers', async () => {
      guarded = await enterWithTestAccount(page, request, profile, testInfo);
    });
    return { ownerName: undefined, guarded };
  }
  await journey.step('A', '1', 'register and land on /grupos', () => register(page, personA));
  return { ownerName: personA.displayName, guarded: undefined };
}

/** Si la prueba ya falló, un fallo de la limpieza se anota sin tapar el fallo original. */
async function sweepAtEnd(account: GuardedAccount, testFailed: boolean, testInfo: TestInfo): Promise<void> {
  try {
    const swept = await sweepSuiteLeftovers(account);
    testInfo.annotations.push({ type: 'sweep-end', description: describeSweep(swept) });
  } catch (error) {
    if (!testFailed) {
      throw error;
    }
    testInfo.annotations.push({ type: 'cleanup-error', description: String(error) });
  }
}

/**
 * Borrado al terminar (design D10, tarea 4.2), en el `finally` de la prueba: solo en una cuenta cuyos guardias
 * pasaron (`undefined` en `local` y cuando un guardia falló: no se toca nada).
 */
async function cleanUpAtEnd(account: GuardedAccount | undefined, testFailed: boolean, testInfo: TestInfo): Promise<void> {
  if (account === undefined) {
    return;
  }
  await test.step('cleanup: delete what the suite created in the remote account (design D10)', () =>
    sweepAtEnd(account, testFailed, testInfo),
  );
}

/**
 * Paso 2: A crea un grupo, apaga la visibilidad pública por defecto (D10: nada de la suite queda enlazable desde
 * fuera) y ve el detalle con «Propietario» y el código de invitación.
 */
async function createPrivateGroup(page: Page, groupName: string, ownerName: string | undefined): Promise<void> {
  await page.getByRole('button', { name: 'Crear un grupo' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre del grupo', { exact: true }).fill(groupName);
  const created = page.waitForResponse(isApiCall('POST', /^\/api\/groups$/));
  const detail = page.waitForURL(/\/grupos\/[0-9a-f]{24}$/);
  await dialog.getByRole('button', { name: 'Crear grupo' }).click();
  expect((await created).status()).toBe(201);
  await detail;
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible();

  const publicDefault = page.getByRole('switch', { name: 'Los links nuevos se comparten con un enlace público' });
  await expect(publicDefault).toBeChecked();
  const settings = page.waitForResponse(isApiCall('PATCH', /^\/api\/groups\/[0-9a-f]{24}\/settings$/));
  await publicDefault.click();
  const settingsResponse = await settings;
  expect(settingsResponse.status()).toBe(200);
  expect(groupDetailSchema.parse(await settingsResponse.json()).defaultVisibility).toBe('private');
  await expect(publicDefault).not.toBeChecked();

  const owner = page.getByRole('listitem').filter({ hasText: 'Propietario' });
  await expect(owner).toHaveCount(1);
  await expect(owner).toContainText(ownerName ?? '');
  await expect(page.getByRole('heading', { level: 2, name: 'Código de invitación' })).toBeVisible();
  await expect(page.getByTestId('invite-code')).toHaveText(INVITE_CODE);
}

/**
 * Link de la oferta de una persona en esta ejecución: un dominio reservado (`.invalid`, RFC 2606) que no es de nadie, de
 * modo que el `worker` del destino no pida nada a una bolsa real (D10); distinto por ejecución (D11), porque los links
 * se deduplican entre todas las cuentas.
 */
function jobUrl(runIdentifier: string): string {
  return `https://empleos.e2e-camino.invalid/ofertas/${encodeURIComponent(runIdentifier)}`;
}

/** Tarjeta del link cuya URL es `url` (su enlace abre la URL tal y como se guardó). */
function linkCard(page: Page, url: string): Locator {
  return page.getByRole('listitem').filter({ has: page.locator(`a[href="${url}"]`) });
}

/** Paso 3: A guarda en el grupo el link de la oferta y la tarjeta aparece. */
async function saveJobLink(page: Page, url: string): Promise<void> {
  await page.getByLabel('Pega el enlace de una oferta', { exact: true }).fill(url);
  const saved = page.waitForResponse(isApiCall('POST', /^\/api\/links$/));
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(linkCard(page, url)).toHaveCount(1);
}

/**
 * Paso 4: la lectura automática no puede leer un dominio `.invalid`; cuando la tarjeta ofrece «Completar a mano», A
 * escribe la oferta de la entrada versionada (D7) y la tarjeta queda legible, con «Escrito por …» en el título.
 * `authorName` es el nombre visible de A si la prueba lo conoce (en `remote`, la cuenta la creó el autor).
 */
async function completeOfferByHand(
  page: Page,
  url: string,
  job: CriticalPathJob,
  authorName: string | undefined,
): Promise<void> {
  const card = linkCard(page, url);
  const completeByHand = card.getByRole('button', { name: 'Completar a mano' });
  await expect(completeByHand).toBeVisible({ timeout: ENRICHMENT_SETTLED_TIMEOUT });
  await completeByHand.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Corregir la oferta' })).toBeVisible();
  await dialog.getByLabel('Puesto', { exact: true }).fill(job.title);
  await dialog.getByLabel('Empresa', { exact: true }).fill(job.company);
  await dialog.getByLabel('Resumen', { exact: true }).fill(job.text);
  const saved = page.waitForResponse(isApiCall('PATCH', /^\/api\/links\/[0-9a-f]{24}\/preview$/));
  await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(200);
  const preview = updatePreviewResponseSchema.parse(await savedResponse.json()).preview;
  expect(preview?.title).toBe(job.title);
  expect(preview?.company).toBe(job.company);
  expect(preview?.summary).toBe(job.text);
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await expect(card.getByRole('link', { name: job.title })).toBeVisible();
  // Título y empresa los escribió A: los dos llevan su procedencia.
  const writtenBy = authorName === undefined ? /^Escrito por .+/ : `Escrito por ${authorName}`;
  await expect(card.getByTestId('note-title')).toHaveText(writtenBy);
  await expect(card.getByTestId('note-company')).toHaveText(writtenBy);
  await expect(card.getByText('Completar a mano')).toHaveCount(0);
}

/** `GET /api/applications` del tablero: sin `linkIds` (la lista del grupo pide los estados de sus links con ellos). */
function isBoardList(response: Response): boolean {
  const url = new URL(response.url());
  return response.request().method() === 'GET' && url.pathname === '/api/applications' && !url.searchParams.has('linkIds');
}

/**
 * Paso 5: A pulsa «Postulé» en la tarjeta y contesta «Hoy»; la tarjeta dice su postulación, y en `/postulaciones` la
 * oferta está en la columna «Postuladas». La postulación queda privada: la invitación a compartirla no se acepta.
 */
async function applyToday(page: Page, url: string, job: CriticalPathJob): Promise<void> {
  const card = linkCard(page, url);
  await card.getByRole('button', { name: 'Postulé', exact: true }).click();
  const question = page.getByRole('dialog');
  await expect(question).toContainText('¿Cuándo postulaste?');
  const tracked = page.waitForResponse(isApiCall('POST', /^\/api\/applications$/));
  await question.getByRole('button', { name: 'Hoy', exact: true }).click();
  const trackedResponse = await tracked;
  expect(trackedResponse.status()).toBe(201);
  const { application } = trackLinkResponseSchema.parse(await trackedResponse.json());
  expect(application.status).toBe('applied');
  expect(application.visibility).toBe('private');
  await expect(card.getByTestId('link-own-status')).toHaveText(/Tu postulación:\s*Postulada/);

  const board = page.waitForResponse(isBoardList);
  const landed = page.waitForURL(/\/postulaciones$/);
  await page.getByRole('link', { name: 'Postulaciones', exact: true }).click();
  expect((await board).status()).toBe(200);
  await landed;
  await expect(page.getByRole('heading', { level: 1, name: 'Postulaciones' })).toBeVisible();
  const applied = page.getByRole('region', { name: /^Postuladas/ });
  const offer = applied.getByRole('article').filter({ hasText: job.title });
  await expect(offer).toHaveCount(1);
  await expect(offer).toContainText('Postulaste hoy');
}

test(
  'critical path: sign up, group, link, application, CV and match',
  { tag: ['@lot1', '@critical-path', '@remote-safe'] },
  async ({ page, request, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    const profile = resolveProfile(process.env, baseURL);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const id = runId(testInfo);
    const personA: Person = {
      displayName: `Persona A ${id}`,
      email: `e2e-cp-a-${id}@example.com`,
      password: `Camino-A-${id}`,
    };
    const groupName = `${SUITE_PREFIX}camino ${id}`;
    const job = readCriticalPathJob();
    const urlA = jobUrl(`a-${id}`);
    const journey = new Journey();

    let guarded: GuardedAccount | undefined;
    let failed = true;
    try {
      const entry = await enter(journey, page, request, profile, personA, testInfo);
      guarded = entry.guarded;
      await journey.step('A', '2', 'create a group without public visibility; detail with owner and invite code', () =>
        createPrivateGroup(page, groupName, entry.ownerName),
      );
      await journey.step('A', '3', 'save the link of an offer on a reserved domain; the card appears', () =>
        saveJobLink(page, urlA),
      );
      await journey.step('A', '4', 'complete the offer by hand with the versioned input; "Escrito por …"', () =>
        completeOfferByHand(page, urlA, job, entry.ownerName),
      );
      await journey.step('A', '5', 'apply "today"; the card shows it and the board has it in "Postuladas"', () =>
        applyToday(page, urlA, job),
      );

      journey.assertDeclared(profile.name, DECLARED_STEPS[profile.name]);
      expect(pageErrors).toEqual([]);
      failed = false;
    } finally {
      await cleanUpAtEnd(guarded, failed, testInfo);
    }
  },
);
