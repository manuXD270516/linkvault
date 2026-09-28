import {
  cvDocumentSchema,
  groupDetailSchema,
  groupSummarySchema,
  type MatchLatest,
  type MatchReportCore,
  matchAnalysisResponseSchema,
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
import {
  CRITICAL_PATH_CV_FILE_NAME,
  CRITICAL_PATH_CV_LINES,
  type CriticalPathJob,
  readCriticalPathJob,
  readCriticalPathMatchReport,
} from './support/critical-path-input';
import { minimalPdf } from './support/cv-files';
import { Journey, type Person as PersonKey, type StepKey } from './support/journey';
import { type Profile, type ProfileName, resolveProfile } from './support/profile';
import type { MatchExpectation } from '../scripts/lib/args';
import {
  assertRemoteAccountGuards,
  describeSweep,
  type GuardedAccount,
  SUITE_PREFIX,
  sweepSuiteLeftovers,
  TEST_ACCOUNT_ALIAS,
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
 * | 2b | A pulsa «Copiar invitación»; B, **sin sesión** y en un contexto aparte con el dispositivo del proyecto, abre ese enlace → inicio de sesión con `returnUrl` → «Crear cuenta» → se registra, vuelve a `/unirse` con el código escrito, se une y aterriza en el detalle; A ve a B entre los miembros | sí | no aplicable (D10: sin altas en remoto) |
 * | 3 | Guardar en el grupo el link de una oferta en un dominio reservado (`.invalid`); la tarjeta aparece | A y B | A |
 * | 4 | Completar la oferta a mano con la entrada versionada (D7); «Escrito por …» | A y B | A |
 * | 5 | «Postulé» → «Hoy»; la tarjeta muestra la postulación y `/postulaciones` la tiene en «Postuladas» | A y B | A |
 * | 6 | Subir el CV de líneas fijas generado en la prueba; «Listo · tu CV se leyó bien» | A y B | A |
 * | 7 | «Analizar mi encaje» → «Analizar»; resultado según `E2E_MATCH_EXPECTATION` (D7) | A y B, `replay-report` | A, el del destino |
 * | 8 | Limpieza de lo creado por A: sus postulaciones, sus grupos y sus CV de la suite (D10) | sí | sí |
 *
 * Cada persona guarda **su** link (URL distinta por ejecución) con la misma oferta fija y el mismo CV, así que las dos
 * piden la misma clave de replay (D11). Los intentos de registro no cambian: uno por persona (D5).
 *
 * La limpieza (paso 8) solo se hace sobre una cuenta cuyos guardias pasaron (`GuardedAccount`, D10): en `remote`, los
 * del paso 0; en `local`, los mismos guardias sobre la cuenta que A acaba de registrar, que por eso lleva el alias
 * `+e2e` y tiene el email sin verificar y sin permiso de IA externa. En `remote`, si la prueba falla antes del paso 8,
 * lo que creó se borra igual en el `finally` (tarea 4.2); un guardia que falla deja la cuenta como estaba.
 *
 * Sincronización (D11): cada paso arma **antes** de la acción la espera de la respuesta o de la navegación que provoca
 * y afirma con aserciones web-first. El paso 0 no afirma el texto del aviso de email (35b lo cambia): el estado del
 * email lo comprueba el guardia por la API.
 */

/** Pasos que ejecuta cada perfil, por persona. Lo que no está aquí es «no aplicable» en ese perfil. */
const DECLARED_STEPS: Readonly<Record<ProfileName, readonly StepKey[]>> = {
  local: [
    'A:1',
    'A:2',
    'B:2b',
    'A:3',
    'A:4',
    'A:5',
    'A:6',
    'A:7',
    'B:3',
    'B:4',
    'B:5',
    'B:6',
    'B:7',
    'A:8',
  ],
  remote: ['A:0', 'A:2', 'A:3', 'A:4', 'A:5', 'A:6', 'A:7', 'A:8'],
};

/**
 * Techo de la espera a que la lectura automática de la oferta termine (en un dominio `.invalid` no puede prosperar): el
 * `worker` da una lectura por perdida a los `ENRICH_DEADLINE_MS` (45 s en `e2e.env`). Es un techo, no una espera.
 */
const ENRICHMENT_SETTLED_TIMEOUT = 60_000;

/**
 * Techo de la espera a que el `worker` lea el CV (`CV_EXTRACTION_TIMEOUT_MS` es 30 s en `e2e.env`); se espera por el
 * estado visible de la tarjeta, no por tiempo.
 */
const CV_READ_TIMEOUT = 60_000;

/**
 * Techo de la espera a que el análisis de encaje termine: con replay o degradado por falta de permiso dura segundos. Se
 * espera por la respuesta que lo trae resuelto, armada antes de «Analizar», no por tiempo.
 */
const ANALYSIS_TIMEOUT = 120_000;

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

/** Paso 1 (`local`): A se registra y aterriza en `/grupos`. Devuelve el access token de su sesión. */
async function register(page: Page, person: Person): Promise<string> {
  await page.goto('/registro');
  await expect(page.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
  await page.getByLabel('Nombre', { exact: true }).fill(person.displayName);
  await page.getByLabel('Email', { exact: true }).fill(person.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(person.password);
  const registered = page.waitForResponse(isApiCall('POST', /^\/api\/auth\/register$/));
  const landed = page.waitForURL(/\/grupos$/);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  const registeredResponse = await registered;
  expect(registeredResponse.status()).toBe(201);
  const session = sessionResponseSchema.parse(await registeredResponse.json());
  await landed;
  await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
  return session.accessToken;
}

interface Entry {
  /** Nombre visible de A si la prueba lo conoce: en `remote` la cuenta la creó el autor y solo se tiene su email. */
  readonly ownerName: string | undefined;
  /** En `remote`, la cuenta cuyos guardias pasaron en el paso 0. */
  readonly guarded: GuardedAccount | undefined;
  /**
   * Cómo llega el paso 8 a una cuenta con los guardias pasados: en `remote`, la del paso 0; en `local`, pasando los
   * guardias sobre la sesión de A, con el access token de su registro y en el origen de la API del perfil.
   */
  readonly guard: () => Promise<GuardedAccount>;
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
    const account = guarded;
    if (account === undefined) {
      throw new Error('step 0 ended without an account whose guards passed');
    }
    return { ownerName: undefined, guarded: account, guard: () => Promise.resolve(account) };
  }
  let accessToken = '';
  await journey.step('A', '1', 'register and land on /grupos', async () => {
    accessToken = await register(page, personA);
  });
  return {
    ownerName: personA.displayName,
    guarded: undefined,
    guard: () => assertRemoteAccountGuards(new SuiteApi(request, profile.apiOrigin, accessToken)),
  };
}

/**
 * Paso 8 (D10, D11): borra lo que creó A en su cuenta —la postulación sobre el link del grupo, el grupo y el CV de la
 * suite— y comprueba que era exactamente eso y que no queda nada de la suite (un segundo barrido no encuentra nada).
 */
async function cleanUpJourney(account: GuardedAccount, testInfo: TestInfo): Promise<void> {
  const swept = await sweepSuiteLeftovers(account);
  testInfo.annotations.push({ type: 'sweep-end', description: describeSweep(swept) });
  expect(swept, 'step 8 deletes what A created: one group, one application and one CV of the suite').toEqual({
    groups: 1,
    applications: 1,
    cvs: 1,
  });
  expect(await sweepSuiteLeftovers(account), 'after step 8 the account has nothing of the suite').toEqual({
    groups: 0,
    applications: 0,
    cvs: 0,
  });
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
 * Borrado al terminar cuando la prueba falló antes del paso 8 (design D10, tarea 4.2), en el `finally`: solo en una
 * cuenta cuyos guardias pasaron (`undefined` en `local` y cuando un guardia falló: no se toca nada).
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
  // El diálogo termina de abrirse llevando el foco a su primer campo (`autoFocus: 'first-tabbable'` de Material). Si se
  // escribe antes, ese foco puede llegar a mitad de un `fill` y el texto del Resumen acaba al final del Puesto (medido
  // el 2026-09-28: el título guardado llevaba el resumen detrás). Se espera a ese foco antes de escribir.
  await expect(dialog.getByLabel('Puesto', { exact: true })).toBeFocused();
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

/** Paso 6: A abre «Mi CV», sube el CV de líneas fijas y la tarjeta dice que se leyó bien. */
async function uploadCv(page: Page): Promise<void> {
  const list = page.waitForResponse(isApiCall('GET', /^\/api\/cv$/));
  const landed = page.waitForURL(/\/mi-cv$/);
  await page.getByRole('link', { name: 'Mi CV', exact: true }).click();
  expect((await list).status()).toBe(200);
  await landed;

  const uploaded = page.waitForResponse(isApiCall('POST', /^\/api\/cv$/));
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Subir CV' }).click();
  await (
    await chooser
  ).setFiles({ name: CRITICAL_PATH_CV_FILE_NAME, mimeType: 'application/pdf', buffer: minimalPdf(CRITICAL_PATH_CV_LINES) });
  const uploadedResponse = await uploaded;
  expect(uploadedResponse.status()).toBe(201);
  const saved = cvDocumentSchema.parse(await uploadedResponse.json());
  expect(saved.fileName).toBe(CRITICAL_PATH_CV_FILE_NAME);

  const cv = page.getByRole('article').filter({ hasText: CRITICAL_PATH_CV_FILE_NAME });
  await expect(cv).toHaveCount(1);
  await expect(cv.getByText('Listo · tu CV se leyó bien')).toBeVisible({ timeout: CV_READ_TIMEOUT });
}

/** Vuelta al detalle del grupo por la interfaz: la marca de la barra lleva a `/grupos` y de ahí, el grupo. */
async function backToGroup(page: Page, groupName: string): Promise<void> {
  const home = page.waitForURL(/\/grupos$/);
  await page.getByRole('link', { name: 'LinkVault', exact: true }).click();
  await home;
  const detail = page.waitForURL(/\/grupos\/[0-9a-f]{24}$/);
  await page.getByRole('link', { name: groupName, exact: true }).click();
  await detail;
  await expect(page.getByRole('heading', { level: 1, name: groupName })).toBeVisible();
}

const MATCH_PATH = /^\/api\/links\/[0-9a-f]{24}\/match$/;

/**
 * La respuesta del sondeo del diálogo (`GET /api/links/:linkId/match`) que trae el análisis resuelto: sin bloque en
 * curso y con el último resultado. Un cuerpo que no valida también la cierra, para que la prueba falle al validarlo.
 */
async function isResolvedMatch(response: Response): Promise<boolean> {
  if (!isApiCall('GET', MATCH_PATH)(response) || response.status() !== 200) {
    return false;
  }
  const body = matchAnalysisResponseSchema.safeParse(await response.json());
  return !body.success || (body.data.running === undefined && body.data.latest !== undefined);
}

/** Imprescindibles primero, estable dentro del mismo peso: el orden en que el diálogo pinta sugerencias y carencias. */
function mustFirst<T>(items: readonly T[], importance: (item: T) => 'must' | 'nice'): T[] {
  return [...items].sort((a, b) => Number(importance(a) === 'nice') - Number(importance(b) === 'nice'));
}

/**
 * `replay-report` (perfil `local`, D7): el informe es **exactamente** el del fixture de replay de `match-cv` de la
 * entrada versionada —en la API y en el diálogo—, sin degradar.
 */
async function assertReplayReport(dialog: Locator, latest: MatchLatest, label: string): Promise<void> {
  const { key, report: expected } = readCriticalPathMatchReport();
  const report = latest.report;
  expect(report?.degraded, `${label}: the report is degraded (${report?.degradedReason ?? 'no report'})`).toBe(false);
  const core: MatchReportCore | undefined =
    report === undefined
      ? undefined
      : {
          score: report.score,
          matchedSkills: report.matchedSkills,
          missingSkills: report.missingSkills,
          suggestions: report.suggestions,
        };
  expect(core, `${label}: the report is not exactly the one of the fixture match-cv/${key}.json`).toEqual(expected);
  expect(latest.consentRequired, `${label}: consentRequired`).toBe(false);

  await expect(dialog.getByTestId('match-badge-score')).toHaveText(String(expected.score));
  await expect(dialog.getByText('Análisis básico', { exact: true })).toHaveCount(0);
  await expect(dialog.getByTestId('match-matched-skills').getByRole('listitem')).toHaveText(expected.matchedSkills);
  const missing = dialog.getByTestId('match-missing-skills');
  if (expected.missingSkills.length === 0) {
    await expect(missing.getByText('Tienes todas las habilidades que pide esta oferta')).toBeVisible();
  } else {
    const names = mustFirst(expected.missingSkills, (skill) => skill.importance).map((skill) => skill.name);
    await expect(missing.getByRole('listitem')).toHaveText(names);
  }
  // El diálogo enseña cinco de entrada; el fixture del recorrido tiene menos, y así se ven todas.
  expect(expected.suggestions.length, `fixture match-cv/${key}.json: more suggestions than the dialog shows`).toBeLessThanOrEqual(5);
  const suggestions = dialog.getByTestId('match-suggestion');
  await expect(suggestions).toHaveCount(expected.suggestions.length);
  for (const [index, suggestion] of mustFirst(expected.suggestions, (item) => item.evidence.importance).entries()) {
    const item = suggestions.nth(index);
    await expect(item.getByTestId('match-suggestion-section')).toHaveText(suggestion.section);
    await expect(item.getByTestId('match-suggestion-after')).toHaveText(suggestion.after);
    await expect(item.getByTestId('match-suggestion-reason')).toHaveText(suggestion.reason);
    await expect(item.getByTestId('match-suggestion-job')).toHaveText(suggestion.evidence.jobRequirement);
    const fragment = suggestion.evidence.cvFragment;
    await expect(item.getByTestId(fragment === null ? 'match-suggestion-cv-missing' : 'match-suggestion-cv')).toHaveText(
      fragment ?? 'Esto no aparece en tu CV',
    );
  }
}

/**
 * `consent-required` (ensayo y staging, D7): la cuenta no tiene permiso de IA externa, así que el análisis degrada por
 * falta de permiso **sin llamar a nadie**; si se hubiera llamado a un proveedor, el motivo sería otro.
 */
async function assertConsentRequired(dialog: Locator, latest: MatchLatest, label: string): Promise<void> {
  const report = latest.report;
  expect(report?.degraded, `${label}: the report is not degraded`).toBe(true);
  expect(
    report?.degradedReason,
    `${label}: the analysis degraded for another reason than the missing external AI permission`,
  ).toBe('consent_required');
  expect(latest.consentRequired, `${label}: consentRequired`).toBe(true);

  await expect(dialog.getByText('Análisis básico', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Para analizar tu CV con IA necesitamos tu permiso.', { exact: true })).toBeVisible();
  await expect(dialog.getByTestId('match-badge-label')).toHaveText('Encaje aproximado — comparamos listas de habilidades');
  await expect(dialog.getByTestId('match-badge-score')).toHaveCount(0);
  await expect(dialog.getByTestId('match-suggestion')).toHaveCount(0);
}

/**
 * Paso 7: desde la tarjeta, «Analizar mi encaje» → «Analizar» con el CV del paso 6, y el resultado que declara el
 * destino (`E2E_MATCH_EXPECTATION`, D7): no se deduce en la prueba. El análisis se espera por la respuesta del sondeo
 * que lo trae resuelto, armada antes del clic, con `ANALYSIS_TIMEOUT` como techo.
 */
async function analyzeMatch(
  page: Page,
  url: string,
  job: CriticalPathJob,
  expectation: MatchExpectation,
): Promise<void> {
  const label = `E2E_MATCH_EXPECTATION=${expectation}`;
  await linkCard(page, url).getByRole('button', { name: 'Analizar mi encaje', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Tu encaje con esta oferta' })).toBeVisible();
  await expect(dialog.getByTestId('match-job-title')).toHaveText(job.title);
  await expect(dialog.getByText(`CV: ${CRITICAL_PATH_CV_FILE_NAME}`, { exact: true })).toBeVisible();
  const analyze = dialog.getByRole('button', { name: 'Analizar', exact: true });
  await expect(analyze).toBeEnabled();

  const requested = page.waitForResponse(isApiCall('POST', MATCH_PATH));
  const resolved = page.waitForResponse(isResolvedMatch, { timeout: ANALYSIS_TIMEOUT });
  await analyze.click();
  expect((await requested).status()).toBe(202);
  const latest = matchAnalysisResponseSchema.parse(await (await resolved).json()).latest;
  if (latest?.status !== 'done') {
    throw new Error(
      `${label}: the analysis ended ${latest?.status ?? 'without a result'} (failure code ${latest?.failureCode ?? '-'})`,
    );
  }
  await expect(dialog.getByTestId('match-badge')).toBeVisible();
  if (expectation === 'replay-report') {
    await assertReplayReport(dialog, latest, label);
  } else {
    await assertConsentRequired(dialog, latest, label);
  }

  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

/**
 * Paso 2b, mitad de A: pulsa «Copiar invitación» en el detalle del grupo y lee lo copiado. Devuelve el enlace del
 * mensaje, que tiene que llevar el código que enseña el detalle y apuntar al origen de la aplicación (D9).
 */
async function copyInvitationLink(page: Page, baseUrl: string): Promise<{ link: string; code: string }> {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const code = ((await page.getByTestId('invite-code').textContent()) ?? '').trim();
  expect(code).toMatch(INVITE_CODE);
  await page.getByRole('button', { name: 'Copiar invitación', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitación copiada' })).toBeVisible();
  const message = await page.evaluate(() => navigator.clipboard.readText());
  const link = /(https?:\/\/\S+\/unirse\?codigo=[^\s)]+)/.exec(message)?.[1];
  if (link === undefined) {
    throw new Error(`step 2b: the copied invitation has no /unirse?codigo=… link: ${message}`);
  }
  const url = new URL(link);
  expect(url.origin, 'step 2b: the invitation link points to the application origin').toBe(new URL(baseUrl).origin);
  expect(url.searchParams.get('codigo'), 'step 2b: the invitation link carries the invite code').toBe(code);
  return { link, code };
}

/**
 * Paso 2b, mitad de B: **sin sesión**, abre el enlace copiado; el guardia lo lleva al inicio de sesión con `returnUrl`;
 * pulsa «Crear cuenta», se registra y vuelve a `/unirse` con el código ya escrito; se une y aterriza en el detalle del
 * grupo de A, donde figura como «Miembro».
 */
async function joinByInvitation(
  pageB: Page,
  invitation: { readonly link: string; readonly code: string },
  person: Person,
  group: { readonly id: string; readonly name: string },
): Promise<void> {
  const returnUrl = `/unirse?codigo=${invitation.code}`;
  const toLogin = pageB.waitForURL((url) => url.pathname === '/login' && url.searchParams.get('returnUrl') === returnUrl);
  await pageB.goto(invitation.link);
  await toLogin;
  await expect(pageB.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();

  const toRegister = pageB.waitForURL(
    (url) => url.pathname === '/registro' && url.searchParams.get('returnUrl') === returnUrl,
  );
  await pageB.getByRole('link', { name: 'Crear cuenta', exact: true }).click();
  await toRegister;
  await expect(pageB.getByRole('heading', { level: 1, name: 'Crear cuenta' })).toBeVisible();
  await pageB.getByLabel('Nombre', { exact: true }).fill(person.displayName);
  await pageB.getByLabel('Email', { exact: true }).fill(person.email);
  await pageB.getByLabel('Contraseña', { exact: true }).fill(person.password);
  const registered = pageB.waitForResponse(isApiCall('POST', /^\/api\/auth\/register$/));
  const backToJoin = pageB.waitForURL((url) => url.pathname === '/unirse');
  await pageB.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
  expect((await registered).status()).toBe(201);
  await backToJoin;

  const dialog = pageB.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Unirse a un grupo' })).toBeVisible();
  await expect(dialog.getByLabel('Código de invitación', { exact: true })).toHaveValue(invitation.code);
  const joined = pageB.waitForResponse(isApiCall('POST', /^\/api\/groups\/join$/));
  const landed = pageB.waitForURL((url) => url.pathname === `/grupos/${group.id}`);
  await dialog.getByRole('button', { name: 'Unirme', exact: true }).click();
  const joinedResponse = await joined;
  expect(joinedResponse.status()).toBe(200);
  const summary = groupSummarySchema.parse(await joinedResponse.json());
  expect(summary.id).toBe(group.id);
  expect(summary.role).toBe('member');
  await landed;
  await expect(pageB.getByRole('heading', { level: 1, name: group.name })).toBeVisible();
  await expect(memberRow(pageB, person.displayName)).toContainText('Miembro');
}

/** Fila de una persona en la lista de miembros del detalle del grupo. */
function memberRow(page: Page, displayName: string): Locator {
  return page.getByTestId('members').getByRole('listitem').filter({ hasText: displayName });
}

/** Pasos 3 a 7 de una persona (D11): su propio link, la oferta a mano, la postulación, el CV y el análisis. */
async function stepsThreeToSeven(
  journey: Journey,
  who: PersonKey,
  page: Page,
  url: string,
  job: CriticalPathJob,
  authorName: string | undefined,
  groupName: string,
  expectation: MatchExpectation,
): Promise<void> {
  await journey.step(who, '3', 'save the link of an offer on a reserved domain; the card appears', () =>
    saveJobLink(page, url),
  );
  await journey.step(who, '4', 'complete the offer by hand with the versioned input; "Escrito por …"', () =>
    completeOfferByHand(page, url, job, authorName),
  );
  await journey.step(who, '5', 'apply "today"; the card shows it and the board has it in "Postuladas"', () =>
    applyToday(page, url, job),
  );
  await journey.step(who, '6', 'upload the fixed-lines CV; "Listo · tu CV se leyó bien"', () => uploadCv(page));
  await journey.step(who, '7', `analyze the match; outcome ${expectation}`, async () => {
    await backToGroup(page, groupName);
    await analyzeMatch(page, url, job, expectation);
  });
}

test(
  'critical path: sign up, group, link, application, CV and match',
  { tag: ['@lot1', '@critical-path', '@remote-safe'] },
  async ({ page, request, browser, baseURL }, testInfo) => {
    // Techo, no espera: dos personas en `local`, cada una con su lectura de oferta, su CV y su análisis.
    test.setTimeout(360_000);
    const profile = resolveProfile(process.env, baseURL);
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    const id = runId(testInfo);
    const personA: Person = {
      displayName: `Persona A ${id}`,
      // Con el alias de las cuentas de prueba (D10): el paso 8 limpia solo tras pasar los guardias, también en `local`.
      email: `e2e-cp-a-${id}${TEST_ACCOUNT_ALIAS}@example.com`,
      password: `Camino-A-${id}`,
    };
    const personB: Person = {
      displayName: `Persona B ${id}`,
      email: `e2e-cp-b-${id}@example.com`,
      password: `Camino-B-${id}`,
    };
    const groupName = `${SUITE_PREFIX}camino ${id}`;
    const job = readCriticalPathJob();
    const urlA = jobUrl(`a-${id}`);
    const urlB = jobUrl(`b-${id}`);
    const journey = new Journey();
    // B, en un contexto de navegador aparte y sin sesión; `browser.newContext()` lleva las opciones del proyecto.
    const contextB = profile.name === 'local' ? await browser.newContext() : undefined;

    let guarded: GuardedAccount | undefined;
    let cleaned = false;
    let failed = true;
    try {
      const entry = await enter(journey, page, request, profile, personA, testInfo);
      guarded = entry.guarded;
      await journey.step('A', '2', 'create a group without public visibility; detail with owner and invite code', () =>
        createPrivateGroup(page, groupName, entry.ownerName),
      );
      const pageB = contextB === undefined ? undefined : await contextB.newPage();
      if (pageB !== undefined) {
        pageB.on('pageerror', (error) => pageErrors.push(`B: ${error.message}`));
        await journey.step(
          'B',
          '2b',
          'A copies the invitation; B, without a session, opens it, creates an account from the login and joins',
          async () => {
            // Mismo dispositivo que el proyecto (D11): un contexto sin sus opciones sería otro navegador.
            expect(pageB.viewportSize(), 'B uses the device of the project').toEqual(page.viewportSize());
            expect(await pageB.evaluate(() => navigator.userAgent)).toBe(await page.evaluate(() => navigator.userAgent));
            const group = { id: new URL(page.url()).pathname.split('/').pop() ?? '', name: groupName };
            const invitation = await copyInvitationLink(page, profile.baseUrl);
            await joinByInvitation(pageB, invitation, personB, group);
            await backToGroup(page, groupName);
            await expect(memberRow(page, personB.displayName), 'the group detail of A lists B as a member').toContainText(
              'Miembro',
            );
          },
        );
      }
      await stepsThreeToSeven(journey, 'A', page, urlA, job, entry.ownerName, groupName, profile.matchExpectation);
      if (pageB !== undefined) {
        await stepsThreeToSeven(journey, 'B', pageB, urlB, job, personB.displayName, groupName, profile.matchExpectation);
      }
      await journey.step('A', '8', 'clean up what A created: the application, the group and the CV of the suite', async () => {
        const account = await entry.guard();
        guarded = account;
        await cleanUpJourney(account, testInfo);
        cleaned = true;
      });

      journey.assertDeclared(profile.name, DECLARED_STEPS[profile.name]);
      expect(pageErrors).toEqual([]);
      failed = false;
    } finally {
      if (!cleaned) {
        await cleanUpAtEnd(guarded, failed, testInfo);
      }
      await contextB?.close();
    }
  },
);
