import { groupDetailSchema } from '@linkvault/shared';
import { expect, test, type Page, type Response, type TestInfo } from '@playwright/test';
import { Journey, type StepKey } from './support/journey';
import { type Profile, type ProfileName, type RemoteAccount, resolveProfile } from './support/profile';
import { assertRemoteAccountGuards, SUITE_PREFIX, sweepSuiteLeftovers } from './support/remote-account';

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
 *
 * Los pasos 2b a 8 los añaden las tareas 5.2 a 5.10, cada una con su línea en `DECLARED_STEPS`.
 *
 * Sincronización (D11): cada paso arma **antes** de la acción la espera de la respuesta o de la navegación que provoca
 * y afirma con aserciones web-first. El paso 0 no afirma el texto del aviso de email (35b lo cambia): el estado del
 * email lo comprueba el guardia por la API.
 */

/** Pasos que ejecuta cada perfil, por persona. Lo que no está aquí es «no aplicable» en ese perfil. */
const DECLARED_STEPS: Readonly<Record<ProfileName, readonly StepKey[]>> = {
  local: ['A:1', 'A:2'],
  remote: ['A:0', 'A:2'],
};

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

/** Paso 0 (`remote`): entrar con la cuenta de prueba declarada, guardias por la API y, solo después, limpieza previa. */
async function enterWithTestAccount(page: Page, account: RemoteAccount): Promise<void> {
  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: 'Iniciar sesión' })).toBeVisible();
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
  const login = page.waitForResponse(isApiCall('POST', /^\/api\/auth\/login$/));
  const landed = page.waitForURL(/\/grupos$/);
  await page.getByRole('button', { name: 'Entrar' }).click();
  expect((await login).status()).toBe(200);
  await landed;
  await expect(page.getByRole('heading', { level: 1, name: 'Tus grupos' })).toBeVisible();
  // Los guardias (tarea 4.3a) van antes que cualquier cambio en la cuenta, incluida la limpieza (tarea 4.2).
  await assertRemoteAccountGuards();
  await sweepSuiteLeftovers();
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

/**
 * Entrada según el perfil: el paso 0 en `remote`, el 1 en `local` (D11). Devuelve el nombre visible de A si lo
 * conoce: en `remote` la cuenta la creó el autor y la prueba solo tiene su email.
 */
async function enter(
  journey: Journey,
  page: Page,
  profile: Profile,
  personA: Person,
): Promise<string | undefined> {
  const account = profile.remoteAccount;
  if (profile.name === 'remote' && account !== undefined) {
    await journey.step('A', '0', 'enter with the declared test account, API guards, sweep of leftovers', () =>
      enterWithTestAccount(page, account),
    );
    return undefined;
  }
  await journey.step('A', '1', 'register and land on /grupos', () => register(page, personA));
  return personA.displayName;
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

test(
  'critical path: sign up, group, link, application, CV and match',
  { tag: ['@lot1', '@critical-path', '@remote-safe'] },
  async ({ page, baseURL }, testInfo) => {
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
    const journey = new Journey();

    const ownerName = await enter(journey, page, profile, personA);
    await journey.step('A', '2', 'create a group without public visibility; detail with owner and invite code', () =>
      createPrivateGroup(page, groupName, ownerName),
    );

    journey.assertDeclared(profile.name, DECLARED_STEPS[profile.name]);
    expect(pageErrors).toEqual([]);
  },
);
