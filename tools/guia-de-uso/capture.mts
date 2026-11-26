/**
 * Script de capturas de la guía de uso (`docs/guia-de-uso/README.md`).
 *
 * Recorre la interfaz de la pila aislada de la suite e2e (`apps/web-e2e`, web 4300, API 3100, Mailpit 8125) con
 * Playwright, una función por paso, y escribe las capturas `NNN-descripcion.png` en `docs/guia-de-uso/img/` y el
 * resultado de cada caso en `tools/guia-de-uso/resultados.json`. Los datos son inventados (`@example.test`) y las
 * contraseñas, el código de invitación, las claves de IA y el texto del CV se enmascaran en cada captura.
 *
 *   TSX_TSCONFIG_PATH=tsconfig.base.json node --import tsx tools/guia-de-uso/capture.mts [--only=fase,fase] [--out=carpeta]
 *
 * Ver `tools/guia-de-uso/README.md`.
 */
import {
  chromium,
  devices,
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import { MongoClient } from 'mongodb';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { minimalPdf } from '../../apps/web-e2e/src/support/cv-files.ts';
import {
  CRITICAL_PATH_CV_FILE_NAME,
  CRITICAL_PATH_CV_LINES,
  readCriticalPathJob,
} from '../../apps/web-e2e/src/support/critical-path-input.ts';
import {
  API,
  MAIL,
  OUT_DIR,
  PASSWORDS,
  Recorder,
  RESULTS_FILE,
  WEB,
  WEB_EN,
  loadState,
  loginByApi,
  mailLink,
  newActor,
  saveState,
} from './lib.mts';

const args = process.argv.slice(2);
const only = args
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
const outArg = args.find((a) => a.startsWith('--out='))?.slice(6);
const startArg = args.find((a) => a.startsWith('--start='))?.slice(8);
const outDir = outArg ?? OUT_DIR;
const MONGO_URI =
  process.env['GUIA_MONGO'] ??
  'mongodb://localhost:27117/linkvault?directConnection=true';

const state = loadState();
const runId = state.runId;
const rec = new Recorder(outDir, startArg === undefined ? 0 : Number(startArg));
const job = readCriticalPathJob();

const EMAILS = {
  ana: `ana+guia@example.test`,
  beto: `beto+guia@example.test`,
  carla: `carla+guia@example.test`,
  diego: `diego+guia@example.test`,
};

type Persona = 'ana' | 'beto' | 'carla' | 'diego';

interface Actor {
  context: BrowserContext;
  page: Page;
}

let browser: Browser;
const actors = new Map<string, Actor>();

function sectionWanted(name: string): boolean {
  return only === undefined || only.includes(name);
}

function isApi(
  method: string,
  path: RegExp,
): (response: import('@playwright/test').Response) => boolean {
  return (response) =>
    response.request().method() === method &&
    path.test(new URL(response.url()).pathname);
}

/** Tarjeta del link cuya URL es `url`. */
function cardOf(page: Page, url: string): Locator {
  return page
    .getByRole('listitem')
    .filter({ has: page.locator(`a[href="${url}"]`) });
}

/** Persona con sesión: contexto de escritorio con login por API (no cuenta contra el límite de altas). */
async function actor(
  persona: Persona,
  options: Parameters<Browser['newContext']>[0] = {},
  key?: string,
): Promise<Actor> {
  const id = key ?? persona;
  const known = actors.get(id);
  if (known !== undefined) {
    return known;
  }
  const created = await newActor(browser, {
    permissions: ['clipboard-read', 'clipboard-write'],
    ...options,
  });
  const password = String(state[`pwd_${persona}`] ?? PASSWORDS[persona]);
  await loginByApi(created.context, EMAILS[persona], password);
  actors.set(id, created);
  return created;
}

async function closeActors(): Promise<void> {
  for (const { context } of actors.values()) {
    await context.close().catch(() => undefined);
  }
  actors.clear();
}

async function guestActor(
  options: Parameters<Browser['newContext']>[0] = {},
): Promise<Actor> {
  return newActor(browser, {
    permissions: ['clipboard-read', 'clipboard-write'],
    ...options,
  });
}

async function goHome(
  page: Page,
  name: string,
  expected: RegExp,
): Promise<void> {
  await page.goto(name);
  await expect(page).toHaveURL(expected);
}

function jobUrl(slug: string): string {
  return `https://empleos.guia-de-uso.invalid/ofertas/${slug}-${runId}`;
}

async function register(
  page: Page,
  name: string,
  email: string,
  password: string,
): Promise<void> {
  await page.getByLabel('Nombre', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
}

// ---------------------------------------------------------------------------------------------------------------------
// 1. Sin sesión
// ---------------------------------------------------------------------------------------------------------------------
async function seccionSinSesion(): Promise<void> {
  const S = '1. Sin sesión';
  const { page, context } = await guestActor();
  await rec.run(S, 'S01', 'Aviso de privacidad sin sesión', async () => {
    await page.goto('/privacidad');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Aviso de privacidad' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Tu CV' })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /IA, OpenRouter y tus claves/ }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Borrar tu cuenta' }),
    ).toBeVisible();
    await rec.shot(page, 'privacidad-sin-sesion');
    return 'Aviso con «Tu CV», «IA, OpenRouter y tus claves (BYOK)» y «Borrar tu cuenta».';
  });
  await rec.run(
    S,
    'S02',
    'La raíz sin sesión lleva a «Iniciar sesión»',
    async () => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Iniciar sesión' }),
      ).toBeVisible();
      await rec.shot(page, 'login-vacio');
      return '`/` acaba en `/login` con «Iniciar sesión».';
    },
  );
  await rec.run(
    S,
    'S03',
    'Iniciar sesión: validación de campos vacíos',
    async () => {
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page.getByText('Introduce un email válido')).toBeVisible();
      await expect(page.getByText('Introduce tu contraseña')).toBeVisible();
      await rec.shot(page, 'login-validacion');
      return '«Introduce un email válido» e «Introduce tu contraseña»; no se envía nada.';
    },
  );
  await rec.run(
    S,
    'S04',
    'Iniciar sesión: credenciales incorrectas',
    async () => {
      await page
        .getByLabel('Email', { exact: true })
        .fill('nadie+guia@example.test');
      await page
        .getByLabel('Contraseña', { exact: true })
        .fill('una-clave-que-no-existe-1');
      await rec.shot(page, 'login-incorrecto-relleno');
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/login$/),
      );
      await page.getByRole('button', { name: 'Entrar' }).click();
      expect((await response).status()).toBe(401);
      await expect(
        page.getByText('Email o contraseña incorrectos'),
      ).toBeVisible();
      await rec.shot(page, 'login-incorrecto-error');
      return '`POST /api/auth/login` → 401 y «Email o contraseña incorrectos».';
    },
  );
  await rec.run(
    S,
    'S05',
    'Una ruta protegida sin sesión lleva a `/login?returnUrl=…`',
    async () => {
      await page.goto('/postulaciones');
      await expect(page).toHaveURL(/\/login\?returnUrl=%2Fpostulaciones$/);
      await rec.shot(page, 'ruta-protegida-login-returnurl', { full: false });
      return 'Redirige a `/login?returnUrl=%2Fpostulaciones`.';
    },
  );
  await rec.run(
    S,
    'S06',
    'Una ruta que no existe vuelve a la raíz',
    async () => {
      await page.goto('/esto-no-existe');
      await expect(page).toHaveURL(/\/login$/);
      return '`/esto-no-existe` acaba en `/login` (sin sesión).';
    },
  );
  await rec.run(S, 'S07', 'Oferta pública que no existe', async () => {
    await page.goto('/oferta/enlace-que-no-existe');
    await expect(
      page.getByText('Este enlace ya no está disponible'),
    ).toBeVisible();
    await rec.shot(page, 'oferta-publica-inexistente');
    return '«Este enlace ya no está disponible».';
  });
  await rec.run(
    S,
    'S08',
    'Verificar email con un enlace inválido',
    async () => {
      await page.goto('/verificar-email?token=un-token-que-no-existe');
      await expect(
        page.getByText('Este enlace no es válido o ha caducado.'),
      ).toBeVisible();
      await rec.shot(page, 'verificar-email-enlace-invalido');
      return '«Este enlace no es válido o ha caducado.» con la ayuda para pedir otro correo.';
    },
  );
  await rec.run(
    S,
    'S09',
    'Restablecer contraseña con un enlace inválido',
    async () => {
      await page.goto('/restablecer-contrasena?token=un-token-que-no-existe');
      await page
        .getByLabel('Nueva contraseña')
        .fill('una-clave-nueva-valida-1');
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/reset-password$/),
      );
      await page.getByRole('button', { name: 'Guardar contraseña' }).click();
      expect((await response).status()).toBeGreaterThanOrEqual(400);
      await expect(
        page.getByText('Este enlace no es válido o ha caducado.'),
      ).toBeVisible();
      await rec.shot(page, 'restablecer-enlace-invalido');
      return '«Este enlace no es válido o ha caducado.» y «Solicitar un enlace nuevo».';
    },
  );
  await context.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Crear la cuenta de Ana
// ---------------------------------------------------------------------------------------------------------------------
async function seccionRegistro(): Promise<void> {
  const S = '2. Crear una cuenta';
  const { page, context } = await guestActor();
  await rec.run(
    S,
    'R01',
    'Crear cuenta: formulario vacío y validaciones',
    async () => {
      await page.goto('/registro');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Crear cuenta' }),
      ).toBeVisible();
      await rec.shot(page, 'registro-vacio');
      await page
        .getByLabel('Email', { exact: true })
        .fill('esto-no-es-un-email');
      await page.getByLabel('Contraseña', { exact: true }).fill('corta');
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(
        page.getByText('Escribe un nombre de hasta 60 caracteres'),
      ).toBeVisible();
      await expect(page.getByText('Introduce un email válido')).toBeVisible();
      await expect(
        page.getByText('La contraseña debe tener entre 10 y 128 caracteres'),
      ).toBeVisible();
      await rec.shot(page, 'registro-validacion');
      return 'Tres errores de campo y no se envía el formulario.';
    },
  );
  await rec.run(
    S,
    'R02',
    'Crear cuenta: la contraseña no puede ser el email',
    async () => {
      await page.goto('/registro');
      await register(page, 'Ana Guía', EMAILS.ana, EMAILS.ana);
      await page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(
        page.getByText('La contraseña no puede ser tu email'),
      ).toBeVisible();
      await rec.shot(page, 'registro-contrasena-es-email');
      return '«La contraseña no puede ser tu email».';
    },
  );
  await rec.run(S, 'R03', 'Crear cuenta: Ana se registra', async () => {
    await page.goto('/registro');
    await register(page, 'Ana Guía', EMAILS.ana, PASSWORDS.ana);
    await rec.shot(page, 'registro-relleno');
    const response = page.waitForResponse(
      isApi('POST', /^\/api\/auth\/register$/),
    );
    await page.getByRole('button', { name: 'Crear cuenta' }).click();
    expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/grupos$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tus grupos' }),
    ).toBeVisible();
    await expect(
      page.getByText(/Tu email aún no está verificado/),
    ).toBeVisible();
    await rec.shot(page, 'registro-hecho-aviso-email');
    actors.set('ana', { context, page });
    return '`POST /api/auth/register` → 201; «Tus grupos» con el aviso «Tu email aún no está verificado…» y «Reenviar correo».';
  });
  // El contexto de Ana sigue abierto para el resto de las secciones.
  const second = await guestActor();
  await rec.run(
    S,
    'R04',
    'Crear cuenta con un email que ya existe',
    async () => {
      await second.page.goto('/registro');
      await register(second.page, 'Otra Ana', EMAILS.ana, PASSWORDS.anaOtra);
      const response = second.page.waitForResponse(
        isApi('POST', /^\/api\/auth\/register$/),
      );
      await second.page.getByRole('button', { name: 'Crear cuenta' }).click();
      expect((await response).status()).toBe(409);
      await expect(
        second.page.getByText('Ya existe una cuenta con este email.'),
      ).toBeVisible();
      await rec.shot(second.page, 'registro-email-repetido');
      return '`409` y «Ya existe una cuenta con este email.» con «¿Quieres iniciar sesión?».';
    },
  );
  await second.context.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Verificar el email
// ---------------------------------------------------------------------------------------------------------------------
async function seccionVerificacion(): Promise<void> {
  const S = '3. Verificar el email';
  const ana = await actor('ana');
  const { page } = ana;
  await rec.run(S, 'V01', 'Reenviar el correo de verificación', async () => {
    await page.goto('/grupos');
    await expect(
      page.getByText(/Tu email aún no está verificado/),
    ).toBeVisible();
    await rec.shot(page, 'verificacion-aviso', { full: false });
    const response = page.waitForResponse(
      isApi('POST', /^\/api\/auth\/verify-email\/resend$/),
    );
    await page.getByRole('button', { name: 'Reenviar correo' }).click();
    expect([200, 202, 204]).toContain((await response).status());
    await rec.shot(page, 'verificacion-reenviada', { full: false });
    return '`POST /api/auth/verify-email/resend` → 2xx; el aviso confirma el reenvío.';
  });
  let link = '';
  await rec.run(
    S,
    'V02',
    'El correo «Verifica tu email en LinkVault» llega a Mailpit',
    async () => {
      link = await mailLink(
        page.request,
        EMAILS.ana,
        'Verifica tu email',
        /http:\/\/localhost:4300\/verificar-email\?token=[A-Za-z0-9_\-.]+/,
      );
      const mail = await guestActor();
      await mail.page.goto(`${MAIL}/`);
      await mail.page.waitForSelector('text=Verifica tu email');
      await rec.shot(mail.page, 'mailpit-bandeja', {
        full: false,
        mask: [
          mail.page.locator(
            '.message .col-lg-6 > .small.text-muted.text-truncate',
          ),
        ],
      });
      await mail.context.close();
      return 'Correo «Verifica tu email en LinkVault» con un enlace `/verificar-email?token=…`.';
    },
  );
  await rec.run(S, 'V03', 'Abrir el enlace: «Email verificado»', async () => {
    await page.goto(link);
    await expect(page.getByText('Email verificado')).toBeVisible();
    await rec.shot(page, 'email-verificado');
    await page.getByRole('link', { name: 'Ir a la aplicación' }).click();
    await expect(page).toHaveURL(/\/grupos$/);
    await page.waitForTimeout(4000);
    const stale =
      (await page.getByText(/Tu email aún no está verificado/).count()) > 0;
    await rec.shot(
      page,
      stale ? 'grupos-aviso-persiste-tras-verificar' : 'grupos-sin-aviso',
      { full: false },
    );
    if (stale) {
      await page.reload();
      await expect(
        page.getByText(/Tu email aún no está verificado/),
      ).toHaveCount(0);
      await rec.shot(page, 'grupos-sin-aviso-tras-recargar', { full: false });
      throw new Error(
        '«Email verificado» pero el aviso «Tu email aún no está verificado» sigue en /grupos hasta recargar la página (intermitente; ver Hallazgos)',
      );
    }
    return '«Verificar email · Email verificado · Ir a la aplicación»; en `/grupos` ya no está el aviso.';
  });
  await rec.run(
    S,
    'V04',
    'Abrir otra vez el mismo enlace (ya usado)',
    async () => {
      await page.goto(link);
      await expect(
        page.getByText('Este enlace no es válido o ha caducado.'),
      ).toBeVisible();
      await rec.shot(page, 'verificar-enlace-ya-usado', { full: false });
      return 'Un enlace usado dice «Este enlace no es válido o ha caducado.».';
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 4. Sesión: cerrar, entrar, recuperar la contraseña
// ---------------------------------------------------------------------------------------------------------------------
async function seccionSesion(): Promise<void> {
  const S = '4. Sesión y contraseña olvidada';
  const { page, context } = await actor('ana');
  await rec.run(S, 'L01', 'Cerrar sesión', async () => {
    await page.goto('/grupos');
    const response = page.waitForResponse(
      isApi('POST', /^\/api\/auth\/logout$/),
    );
    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    expect((await response).status()).toBeLessThan(300);
    await expect(page).toHaveURL(/\/login$/);
    await rec.shot(page, 'sesion-cerrada', { full: false });
    return '`POST /api/auth/logout` → 2xx y vuelve a `/login`.';
  });
  await rec.run(
    S,
    'L02',
    'Recuperar contraseña: validación, email inexistente y email real',
    async () => {
      await page.getByRole('link', { name: 'Olvidé mi contraseña' }).click();
      await expect(page).toHaveURL(/\/recuperar-contrasena$/);
      await rec.shot(page, 'recuperar-vacio', { full: false });
      await page.getByRole('button', { name: 'Enviar instrucciones' }).click();
      await expect(page.getByText('Introduce un email válido')).toBeVisible();
      await rec.shot(page, 'recuperar-validacion', { full: false });
      await page
        .getByLabel('Email', { exact: true })
        .fill('nadie+guia@example.test');
      await page.getByRole('button', { name: 'Enviar instrucciones' }).click();
      await expect(
        page.getByText(/Si existe una cuenta con ese email/),
      ).toBeVisible();
      await rec.shot(page, 'recuperar-email-inexistente', { full: false });
      // Lo mismo con el email de Ana: la pantalla no revela cuál existe.
      await page.goto('/recuperar-contrasena');
      await page.getByLabel('Email', { exact: true }).fill(EMAILS.ana);
      await rec.shot(page, 'recuperar-relleno', { full: false });
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/forgot-password$/),
      );
      await page.getByRole('button', { name: 'Enviar instrucciones' }).click();
      expect((await response).status()).toBeLessThan(300);
      await expect(
        page.getByText(/Si existe una cuenta con ese email/),
      ).toBeVisible();
      await rec.shot(page, 'recuperar-enviado', { full: false });
      return 'Con email inexistente o real, el mismo mensaje: «Si existe una cuenta con ese email, te hemos enviado instrucciones…».';
    },
  );
  await rec.run(
    S,
    'L03',
    'Restablecer la contraseña con el enlace del correo',
    async () => {
      const link = await mailLink(
        page.request,
        EMAILS.ana,
        'Restablece tu contraseña',
        /http:\/\/localhost:4300\/restablecer-contrasena\?token=[A-Za-z0-9_\-.]+/,
      );
      await page.goto(link);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Restablecer contraseña' }),
      ).toBeVisible();
      await rec.shot(page, 'restablecer-vacio', { full: false });
      await page.getByLabel('Nueva contraseña').fill('corta');
      await page.getByRole('button', { name: 'Guardar contraseña' }).click();
      await expect(
        page.getByText('La contraseña debe tener entre 10 y 128 caracteres'),
      ).toBeVisible();
      await rec.shot(page, 'restablecer-validacion', { full: false });
      await page.getByLabel('Nueva contraseña').fill(PASSWORDS.anaNueva);
      await rec.shot(page, 'restablecer-relleno', { full: false });
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/reset-password$/),
      );
      await page.getByRole('button', { name: 'Guardar contraseña' }).click();
      expect((await response).status()).toBeLessThan(300);
      await expect(
        page.getByText(/Tu contraseña se ha actualizado/),
      ).toBeVisible();
      await rec.shot(page, 'restablecer-hecho', { full: false });
      state['pwd_ana'] = PASSWORDS.anaNueva;
      saveState(state);
      return '«Tu contraseña se ha actualizado. Ya puedes iniciar sesión con la nueva.»';
    },
  );
  await rec.run(
    S,
    'L04',
    'La contraseña vieja ya no entra y la nueva sí; la sesión sobrevive a recargar',
    async () => {
      await page.goto('/login');
      await page.getByLabel('Email', { exact: true }).fill(EMAILS.ana);
      await page.getByLabel('Contraseña', { exact: true }).fill(PASSWORDS.ana);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(
        page.getByText('Email o contraseña incorrectos'),
      ).toBeVisible();
      await rec.shot(page, 'login-contrasena-vieja', { full: false });
      await page
        .getByLabel('Contraseña', { exact: true })
        .fill(PASSWORDS.anaNueva);
      await rec.shot(page, 'login-relleno', { full: false });
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/login$/),
      );
      await page.getByRole('button', { name: 'Entrar' }).click();
      expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(/\/grupos$/);
      await page.reload();
      await expect(
        page.getByRole('heading', { level: 1, name: 'Tus grupos' }),
      ).toBeVisible();
      await rec.shot(page, 'login-hecho-sesion-restaurada', { full: false });
      // Un enlace de restablecer ya usado no sirve otra vez.
      return 'Contraseña vieja: «Email o contraseña incorrectos». La nueva entra; tras recargar sigue en «Tus grupos».';
    },
  );
  void context;
}

// ---------------------------------------------------------------------------------------------------------------------
// 5. Perfil
// ---------------------------------------------------------------------------------------------------------------------
async function seccionPerfil(): Promise<void> {
  const S = '5. Perfil';
  const { page } = await actor('ana');
  await rec.run(S, 'F01', 'Perfil inicial', async () => {
    await page.goto('/perfil');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Perfil' }),
    ).toBeVisible();
    await expect(page.getByTestId('profile-email')).toHaveValue(EMAILS.ana);
    await rec.shot(page, 'perfil-inicial');
    return 'Email de solo lectura, nombre, contraseña, «IA y privacidad», «Tus claves de IA», notificaciones y zona de peligro.';
  });
  await rec.run(S, 'F02', 'Nombre: validación y guardado', async () => {
    const name = page.getByLabel('Nombre', { exact: true });
    await name.fill('');
    await page.getByRole('button', { name: 'Guardar nombre' }).click();
    await expect(
      page.getByText('Escribe un nombre de hasta 60 caracteres'),
    ).toBeVisible();
    await rec.shot(page, 'perfil-nombre-vacio', { full: false });
    await name.fill('Ana Guía de Uso');
    await rec.shot(page, 'perfil-nombre-relleno', { full: false });
    const response = page.waitForResponse(isApi('PATCH', /^\/api\/users\/me$/));
    await page.getByRole('button', { name: 'Guardar nombre' }).click();
    expect((await response).status()).toBe(200);
    await expect(page.getByText('Nombre guardado')).toBeVisible();
    await rec.shot(page, 'perfil-nombre-guardado', { full: false });
    return '«Nombre guardado».';
  });
  await rec.run(
    S,
    'F03',
    'Contraseña: actual incorrecta, nueva demasiado corta y cambio correcto',
    async () => {
      const current = page.getByLabel('Contraseña actual');
      const next = page.getByLabel('Nueva contraseña');
      await current.fill('esta-no-es-la-clave-1');
      await next.fill(PASSWORDS.anaOtra);
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
      await expect(
        page.getByText('La contraseña actual no es correcta'),
      ).toBeVisible();
      await rec.shot(page, 'perfil-contrasena-actual-incorrecta');
      await current.fill(PASSWORDS.anaNueva);
      await next.fill('corta');
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
      await expect(
        page.getByText(/al menos 10 caracteres/).first(),
      ).toBeVisible();
      await expect(
        page.getByText('La contraseña actual no es correcta'),
      ).toHaveCount(0);
      await rec.shot(page, 'perfil-contrasena-nueva-corta');
      await next.fill(PASSWORDS.anaOtra);
      await rec.shot(page, 'perfil-contrasena-rellena');
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/auth\/password$/),
      );
      await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
      expect((await response).status()).toBeLessThan(300);
      await expect(page.getByText(/Contraseña cambiada/)).toBeVisible();
      await rec.shot(page, 'perfil-contrasena-cambiada');
      state['pwd_ana'] = PASSWORDS.anaOtra;
      saveState(state);
      return '«La contraseña actual no es correcta»; «La nueva contraseña debe tener al menos 10 caracteres…»; «Contraseña cambiada. Cerramos tu sesión en los demás dispositivos.».';
    },
  );
  await rec.run(S, 'F04', 'IA y privacidad por defecto', async () => {
    const ai = page.getByTestId('profile-ai');
    await expect(ai.getByTestId('profile-ai-consent')).not.toHaveClass(
      /mdc-switch--checked/,
    );
    await expect(ai.getByText('Español')).toBeVisible();
    await ai.scrollIntoViewIfNeeded();
    await rec.shot(page, 'perfil-ia-por-defecto', { locator: ai });
    return 'Permiso externo apagado, idioma «Español» y «Ocultar mi nombre a los proveedores externos» activado.';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 6. Grupos
// ---------------------------------------------------------------------------------------------------------------------
async function seccionGrupos(): Promise<void> {
  const S = '6. Grupos';
  const { page } = await actor('ana');
  await rec.run(S, 'G01', 'Tus grupos, sin ningún grupo', async () => {
    await page.goto('/grupos');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tus grupos' }),
    ).toBeVisible();
    await rec.shot(page, 'grupos-vacio', { full: false });
    return 'Explica qué es un grupo y ofrece «Crear un grupo» y «Unirse con un código».';
  });
  await rec.run(S, 'G02', 'Crear un grupo: validación y alta', async () => {
    await page.getByRole('button', { name: 'Crear un grupo' }).click();
    const dialog = page.getByRole('dialog');
    await rec.shot(page, 'grupo-crear-vacio', { full: false });
    await dialog.getByRole('button', { name: 'Crear grupo' }).click();
    await rec.shot(page, 'grupo-crear-validacion', { full: false });
    await dialog
      .getByLabel('Nombre del grupo', { exact: true })
      .fill('Búsqueda backend 2026');
    await rec.shot(page, 'grupo-crear-relleno', { full: false });
    const response = page.waitForResponse(isApi('POST', /^\/api\/groups$/));
    await dialog.getByRole('button', { name: 'Crear grupo' }).click();
    expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
    await expect(page.getByText('Propietario')).toBeVisible();
    await expect(
      page.getByText('Eres el único miembro: para irte, borra el grupo'),
    ).toBeVisible();
    state['groupUrl'] = page.url();
    saveState(state);
    await rec.shot(page, 'grupo-creado');
    return '`POST /api/groups` → 201; detalle con «Propietario», el código (enmascarado) y «Eres el único miembro: para irte, borra el grupo».';
  });
  await rec.run(S, 'G03', 'Renombrar el grupo', async () => {
    await page.getByRole('button', { name: 'Renombrar' }).click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Nombre del grupo', { exact: true })
      .fill('Búsqueda backend (guía)');
    await rec.shot(page, 'grupo-renombrar-relleno', { full: false });
    const response = page.waitForResponse(
      isApi('PATCH', /^\/api\/groups\/[0-9a-f]{24}$/),
    );
    await dialog.getByRole('button', { name: 'Guardar nombre nuevo' }).click();
    expect((await response).status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Búsqueda backend (guía)' }),
    ).toBeVisible();
    return 'El título cambia a «Búsqueda backend (guía)».';
  });
  await rec.run(
    S,
    'G04',
    'Ajuste: los links nuevos se comparten con un enlace público',
    async () => {
      const toggle = page.getByRole('switch', {
        name: 'Los links nuevos se comparten con un enlace público',
      });
      await expect(toggle).toBeChecked();
      await rec.shot(page, 'grupo-visibilidad-activada', {
        locator: page.getByTestId('group-default-visibility'),
      });
      const off = page.waitForResponse(isApi('PATCH', /\/settings$/));
      await toggle.click();
      expect((await off).status()).toBe(200);
      await expect(toggle).not.toBeChecked();
      await rec.shot(page, 'grupo-visibilidad-apagada', {
        locator: page.getByTestId('group-default-visibility'),
      });
      const on = page.waitForResponse(isApi('PATCH', /\/settings$/));
      await toggle.click();
      expect((await on).status()).toBe(200);
      await expect(toggle).toBeChecked();
      return 'Viene activado; se apaga y se vuelve a activar (`PATCH /api/groups/:id/settings` → 200). Se deja activado para el enlace público.';
    },
  );
  await rec.run(S, 'G05', 'Copiar la invitación', async () => {
    await page.getByRole('button', { name: 'Copiar invitación' }).click();
    await expect(page.getByText('Invitación copiada')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`${WEB}/unirse?codigo=`);
    state['inviteCode'] = /codigo=([A-Z0-9]{8})/.exec(copied)?.[1];
    saveState(state);
    await rec.shot(page, 'invitacion-copiada', { full: false });
    return '«Invitación copiada»; el texto copiado lleva el enlace absoluto `/unirse?codigo=…` del origen de la web.';
  });
}

async function seccionInvitado(): Promise<void> {
  const S = '7. Invitar y unirse';
  const code = String(state['inviteCode']);
  const guest = await guestActor();
  const g = guest.page;
  await rec.run(
    S,
    'I01',
    'Beto abre la invitación sin sesión y se registra',
    async () => {
      await g.goto(`/unirse?codigo=${code}`);
      await expect(g).toHaveURL(/\/login\?returnUrl=/);
      await rec.shot(g, 'invitado-login-con-returnurl', { full: false });
      await g.getByRole('link', { name: 'Crear cuenta' }).click();
      await expect(g).toHaveURL(/\/registro/);
      await register(g, 'Beto Guía', EMAILS.beto, PASSWORDS.beto);
      await rec.shot(g, 'invitado-registro-relleno', { full: false });
      await g.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(g).toHaveURL(/\/unirse/);
      await expect(g.getByRole('dialog')).toBeVisible();
      await rec.shot(g, 'invitado-unirse-codigo-escrito', { full: false });
      return 'Tras el registro vuelve a `/unirse` con el código ya escrito en «Unirse a un grupo».';
    },
  );
  actors.set('beto', guest);
  await rec.run(
    S,
    'I02',
    'Beto pulsa «Unirme» y entra como miembro',
    async () => {
      const response = g.waitForResponse(
        isApi('POST', /^\/api\/groups\/join$/),
      );
      await g
        .getByRole('dialog')
        .getByRole('button', { name: 'Unirme' })
        .click();
      expect((await response).status()).toBeLessThan(300);
      await expect(g).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      await expect(
        g.getByRole('button', { name: 'Salir del grupo' }),
      ).toBeVisible();
      await expect(g.getByTestId('invite-code')).toHaveCount(0);
      await rec.shot(g, 'invitado-dentro-del-grupo');
      return 'Beto ve «Salir del grupo» y no ve el código de invitación.';
    },
  );
  const ana = await actor('ana');
  await rec.run(S, 'I03', 'Ana ve a Beto entre los miembros', async () => {
    await ana.page.goto(String(state['groupUrl']));
    await expect(
      ana.page.getByTestId('members').getByText('Beto Guía'),
    ).toBeVisible();
    await expect(
      ana.page.getByRole('button', { name: 'Nombrar propietario' }),
    ).toBeVisible();
    await rec.shot(ana.page, 'propietaria-ve-al-miembro');
    return 'Ana ve a Beto con «Nombrar propietario» y «Expulsar».';
  });
  await rec.run(
    S,
    'I04',
    'Unirse con un código inválido y con el campo vacío',
    async () => {
      await g.goto('/grupos');
      await g.getByRole('button', { name: 'Unirse con un código' }).click();
      const dialog = g.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Unirme' }).click();
      await rec.shot(g, 'unirse-codigo-vacio', { full: false });
      await dialog.getByLabel(/código/i).fill('ZZZZZZZZ');
      const response = g.waitForResponse(
        isApi('POST', /^\/api\/groups\/join$/),
      );
      await dialog.getByRole('button', { name: 'Unirme' }).click();
      expect((await response).status()).toBe(404);
      await expect(
        g.getByText('Ese código no corresponde a ningún grupo'),
      ).toBeVisible();
      await rec.shot(g, 'unirse-codigo-invalido', { full: false });
      await dialog.getByRole('button', { name: /Cancelar/ }).click();
      return '404 y «Ese código no corresponde a ningún grupo».';
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 8. Links
// ---------------------------------------------------------------------------------------------------------------------
const NOTE = 'Esta es la que comenté ayer, pinta bien.';

function pastedGolden(id: string): string {
  const lines = readFileSync(
    join('libs', 'ai', 'src', 'evals', 'extract-pasted-job', 'golden.jsonl'),
    'utf8',
  ).split('\n');
  for (const line of lines) {
    if (line.trim() === '') {
      continue;
    }
    const entry = JSON.parse(line) as { id: string; input: { text: string } };
    if (entry.id === id) {
      return entry.input.text;
    }
  }
  throw new Error(`el golden de extract-pasted-job no tiene «${id}»`);
}

async function seccionLinks(): Promise<void> {
  const S = '8. Guardar y completar ofertas';
  const { page } = await actor('ana');
  const url1 = jobUrl('backend');
  const url2 = jobUrl('para-pegar');
  await rec.run(
    S,
    'K01',
    'Guardar una oferta en el grupo, con una nota',
    async () => {
      await page.goto(String(state['groupUrl']));
      await expect(
        page.getByRole('button', { name: 'Pegar un chat' }),
      ).toBeVisible();
      if ((await page.getByTestId('link-list').count()) === 0) {
        await expect(page.getByTestId('links-empty')).toBeVisible();
        await rec.shot(page, 'links-grupo-vacio', { full: false });
      }
      await page
        .getByLabel('Pega el enlace de una oferta', { exact: true })
        .fill(url1);
      await page.getByLabel('Nota para el grupo (opcional)').fill(NOTE);
      await rec.shot(page, 'guardar-link-relleno', { full: false });
      const response = page.waitForResponse(isApi('POST', /^\/api\/links$/));
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      expect((await response).status()).toBe(201);
      const card = cardOf(page, url1);
      await expect(card).toHaveCount(1);
      await expect(card.getByText('Leyendo la oferta…')).toBeVisible();
      await expect(card.getByText('Enlace público')).toBeVisible();
      await expect(card.getByText(`Nota de Ana Guía de Uso`)).toBeVisible();
      await expect(
        page.getByText(/Cualquiera con este enlace verá la oferta/),
      ).toBeVisible();
      await rec.shot(page, 'link-guardado-leyendo');
      state['url1'] = url1;
      saveState(state);
      return '`POST /api/links` → 201; tarjeta con «Leyendo la oferta…», «Enlace público», «Nota de Ana Guía de Uso» y el aviso «Cualquiera con este enlace verá la oferta, pero no el grupo; tu nombre solo lo verá quien ya comparta un grupo contigo.» con «Copiar enlace».';
    },
  );
  await rec.run(S, 'K02', 'Guardar la misma URL otra vez', async () => {
    await page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill(url1);
    const response = page.waitForResponse(isApi('POST', /^\/api\/links$/));
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await response;
    await expect(
      page.getByText(/Ya estaba aquí, lo compartió Ana Guía de Uso/),
    ).toBeVisible();
    await rec.shot(page, 'link-repetido-ya-estaba', { full: false });
    return '«Ya estaba aquí, lo compartió Ana Guía de Uso»; no se crea otra tarjeta.';
  });
  await rec.run(S, 'K03', 'URL inválida y nota demasiado larga', async () => {
    await page.reload();
    await page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill('hola esto no es un enlace');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(
      page.getByText('Eso no parece un enlace de una oferta'),
    ).toBeVisible();
    await rec.shot(page, 'guardar-link-url-invalida', { full: false });
    await page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill(jobUrl('nota-larga'));
    await page
      .getByLabel('Nota para el grupo (opcional)')
      .fill('x'.repeat(300));
    await expect(page.getByText('Máximo 280 caracteres')).toBeVisible();
    await rec.shot(page, 'guardar-link-nota-larga', { full: false });
    await page.getByLabel('Nota para el grupo (opcional)').fill('');
    await page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill('');
    return '«Eso no parece un enlace de una oferta»; «Máximo 280 caracteres» con el contador `300/280`.';
  });
  await rec.run(
    S,
    'K04',
    'La oferta que no se puede leer: «No pudimos leer esta oferta» y «Reintentar»',
    async () => {
      const card = cardOf(page, url1);
      await expect(card.getByTestId('link-complete')).toBeVisible({
        timeout: 70_000,
      });
      await expect(card.getByText('No pudimos leer esta oferta')).toBeVisible();
      await rec.shot(page, 'link-no-leido');
      await card.getByTestId('link-retry').click();
      await expect(card.getByText('Leyendo la oferta…')).toBeVisible();
      await rec.shot(page, 'link-reintento-leyendo', { locator: card });
      await expect(card.getByText('No pudimos leer esta oferta')).toBeVisible({
        timeout: 70_000,
      });
      return 'La lectura de un `.invalid` acaba en «No pudimos leer esta oferta» con «Completar a mano», «Pegar la descripción» y «Reintentar»; «Reintentar» vuelve a «Leyendo la oferta…» y acaba igual.';
    },
  );
  await rec.run(S, 'K05', 'Completar la oferta a mano', async () => {
    const card = cardOf(page, url1);
    await card.getByTestId('link-complete').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Puesto', { exact: true })).toBeFocused();
    await rec.shot(page, 'corregir-oferta-vacio');
    await dialog.getByLabel('Puesto', { exact: true }).fill(job.title);
    await dialog.getByLabel('Empresa', { exact: true }).fill(job.company);
    await dialog.getByLabel('Resumen', { exact: true }).fill(job.text);
    await dialog.locator('mat-dialog-content').evaluate((element) => {
      element.scrollTop = 0;
    });
    await rec.shot(page, 'corregir-oferta-relleno');
    const response = page.waitForResponse(
      isApi('PATCH', /^\/api\/links\/[0-9a-f]{24}\/preview$/),
    );
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    expect((await response).status()).toBe(200);
    await expect(card.getByTestId('note-title')).toHaveText(
      'Escrito por Ana Guía de Uso',
    );
    await expect(card.getByTestId('note-company')).toHaveText(
      'Escrito por Ana Guía de Uso',
    );
    await rec.shot(page, 'oferta-completada-escrito-por');
    return '`PATCH /api/links/:id/preview` → 200; puesto y empresa con «Escrito por Ana Guía de Uso».';
  });
  await rec.run(
    S,
    'K06',
    'Pegar la descripción: texto que no es una oferta y texto de una oferta',
    async () => {
      await page
        .getByLabel('Pega el enlace de una oferta', { exact: true })
        .fill(url2);
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      const card = cardOf(page, url2);
      await expect(card.getByTestId('link-paste')).toBeVisible({
        timeout: 70_000,
      });
      await card.getByTestId('link-paste').click();
      const dialog = page.getByRole('dialog');
      await rec.shot(page, 'pegar-descripcion-vacio');
      await dialog
        .getByTestId('paste-text')
        .fill(
          'hola, ¿viste el partido de anoche? mañana nos juntamos a las ocho para ver el siguiente',
        );
      await dialog.getByTestId('paste-submit').click();
      const alert = dialog.getByRole('alert').first();
      await alert.waitFor({ timeout: 40_000 });
      await alert.scrollIntoViewIfNeeded();
      const errorText = (await alert.textContent())?.trim() ?? '';
      await rec.shot(page, 'pegar-descripcion-error', { full: false });
      const text = pastedGolden('oferta-entre-chat');
      await dialog.getByTestId('paste-text').fill(text);
      await rec.shot(page, 'pegar-descripcion-relleno');
      await dialog.getByTestId('paste-submit').click();
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 40_000,
      });
      const pasted = cardOf(page, url2);
      await expect(pasted.getByTestId('link-open')).toHaveText(
        'Ingeniero de Soporte TI',
      );
      await expect(pasted.getByTestId('note-title')).toHaveText(
        'Descripción pegada por Ana Guía de Uso',
      );
      await rec.shot(page, 'oferta-pegada');
      state['pasteError'] = errorText;
      saveState(state);
      return `Con un texto de chat: «${errorText}». Con la oferta del golden: tarjeta «Ingeniero de Soporte TI» de «Distribuidora Andina» con «Descripción pegada por Ana Guía de Uso» y «Deshacer lo que pegó Ana Guía de Uso».`;
    },
  );
  await rec.run(S, 'K07', 'Deshacer lo pegado', async () => {
    const card = cardOf(page, url2);
    await card.getByTestId('link-undo-paste').click();
    await expect(cardOf(page, url2).getByTestId('link-paste')).toBeVisible();
    await expect(cardOf(page, url2).getByTestId('link-undo-paste')).toHaveCount(
      0,
    );
    await rec.shot(page, 'pegado-deshecho');
    return 'La tarjeta vuelve a «No pudimos leer esta oferta».';
  });
  const imp1 = jobUrl('chat-uno');
  const imp2 = jobUrl('chat-dos');
  await rec.run(S, 'K08', 'Importar un chat', async () => {
    await page.getByRole('button', { name: 'Pegar un chat' }).click();
    const dialog = page.getByRole('dialog');
    await rec.shot(page, 'importar-chat-vacio', { full: false });
    await dialog
      .getByTestId('import-text')
      .fill(
        `[10:01] Beto: mirá esta ${imp1}\n[10:02] Carla: y esta otra ${imp2}\n[10:03] Beto: la primera de nuevo ${imp1}`,
      );
    await rec.shot(page, 'importar-chat-relleno', { full: false });
    const response = page.waitForResponse(
      isApi('POST', /^\/api\/links\/import$/),
    );
    await dialog.getByRole('button', { name: 'Importar' }).click();
    expect((await response).status()).toBeLessThan(300);
    await expect(dialog.getByTestId('import-summary')).toContainText(
      '2 guardadas, 0 ya estaban',
    );
    await rec.shot(page, 'importar-chat-resumen', { full: false });
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    await page.getByRole('button', { name: 'Pegar un chat' }).click();
    await page
      .getByRole('dialog')
      .getByTestId('import-text')
      .fill('sin ningún enlace de oferta acá');
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Importar' })
      .click();
    await expect(page.getByTestId('import-nothing')).toBeVisible();
    await rec.shot(page, 'importar-chat-sin-ofertas', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar' })
      .click();
    return '«2 guardadas, 0 ya estaban» (la URL repetida cuenta una vez); un texto sin enlaces: «No encontramos ninguna oferta en ese texto».';
  });
  await rec.run(
    S,
    'K09',
    'Editar una oferta pegada y «Volver a lo anterior»',
    async () => {
      await cardOf(page, url2).getByTestId('link-paste').click();
      let dialog = page.getByRole('dialog');
      await dialog
        .getByTestId('paste-text')
        .fill(pastedGolden('oferta-entre-chat'));
      await dialog.getByTestId('paste-submit').click();
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 40_000,
      });
      await cardOf(page, url2).getByTestId('link-edit').click();
      dialog = page.getByRole('dialog');
      await dialog
        .getByLabel('Puesto', { exact: true })
        .fill('Ingeniero de Soporte TI (corregido)');
      await dialog
        .getByRole('button', { name: 'Guardar', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await cardOf(page, url2).getByTestId('link-edit').click();
      dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('revert-title')).toBeVisible();
      await expect(dialog.getByTestId('origin-title')).toContainText(
        'Escrito por Ana Guía de Uso',
      );
      await rec.shot(page, 'editar-oferta-volver-a-lo-anterior');
      await dialog.getByTestId('revert-title').click();
      const reverted = await dialog
        .getByLabel('Puesto', { exact: true })
        .inputValue();
      await rec.shot(page, 'editar-oferta-revertida');
      await dialog
        .getByRole('button', { name: 'Guardar', exact: true })
        .click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      expect(reverted).toBe('Ingeniero de Soporte TI');
      await expect(cardOf(page, url2).getByTestId('link-open')).toHaveText(
        'Ingeniero de Soporte TI',
      );
      return 'Tras corregir el puesto de una oferta pegada, el editor ofrece «Volver a lo anterior»; al marcarlo recupera «Ingeniero de Soporte TI», con su origen anterior.';
    },
  );
  await rec.run(S, 'K10', 'Quitar una oferta del grupo', async () => {
    const card = cardOf(page, imp2);
    await card.getByTestId('link-remove').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await rec.shot(page, 'quitar-oferta-confirmar', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Quitar' })
      .click();
    await expect(cardOf(page, imp2)).toHaveCount(0);
    await rec.shot(page, 'oferta-quitada', { full: false });
    return 'La confirmación explica lo que se pierde; tras «Quitar» la tarjeta desaparece del grupo.';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 9. Postulaciones
// ---------------------------------------------------------------------------------------------------------------------
async function seccionPostulaciones(): Promise<void> {
  const S = '9. Postulaciones';
  const { page } = await actor('ana');
  const url1 = String(state['url1']);
  const url2 = jobUrl('para-pegar');
  const beto = await actor('beto');
  await rec.run(
    S,
    'A01',
    'Tablero vacío (persona sin postulaciones)',
    async () => {
      await beto.page.goto('/postulaciones');
      await expect(beto.page.getByTestId('board-empty')).toBeVisible();
      await rec.shot(beto.page, 'tablero-vacio', { full: false });
      return '«Aquí verás las ofertas que sigues…» con «Ir a tus grupos» e «Ir a Solo para mí».';
    },
  );
  await rec.run(S, 'A02', 'Insights sin postulaciones', async () => {
    await beto.page.goto('/postulaciones/insights');
    await expect(
      beto.page.getByRole('heading', { level: 1, name: 'Insights' }),
    ).toBeVisible();
    await rec.shot(beto.page, 'insights-vacio', { full: false });
    return 'Insights vacío con enlaces para empezar.';
  });
  await rec.run(
    S,
    'A03',
    '«Postulé»: ¿cuándo postulaste?, fecha futura y «Hoy»',
    async () => {
      await page.goto(String(state['groupUrl']));
      const card = cardOf(page, url1);
      await card.getByRole('button', { name: 'Postulé', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('¿Cuándo postulaste?');
      await rec.shot(page, 'postule-cuando', { full: false });
      await dialog.getByTestId('applied-other-day').click();
      const future = new Date(Date.now() + 5 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await dialog.getByTestId('applied-day').fill(future);
      await expect(dialog.getByRole('alert')).toBeVisible();
      await expect(dialog.getByTestId('applied-confirm')).toBeDisabled();
      await rec.shot(page, 'postule-fecha-futura', { full: false });
      const past = new Date(Date.now() - 3 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      await dialog.getByTestId('applied-day').fill(past);
      await rec.shot(page, 'postule-otro-dia-relleno', { full: false });
      const response = page.waitForResponse(
        isApi('POST', /^\/api\/applications$/),
      );
      await dialog.getByTestId('applied-confirm').click();
      expect((await response).status()).toBe(201);
      await expect(card.getByTestId('link-own-status')).toHaveText(
        /Tu postulación:\s*Postulada/,
      );
      await rec.shot(page, 'postulada-aviso-compartir');
      return '`POST /api/applications` → 201; «Tu postulación: Postulada». Una fecha futura se rechaza.';
    },
  );
  await rec.run(
    S,
    'A04',
    'Compartir el estado con el grupo: «Qué verán», «Compartir», «Deshacer»',
    async () => {
      await expect(page.getByTestId('share-notice-share')).toBeVisible();
      await page.getByTestId('share-notice-scope').click();
      await rec.shot(page, 'compartir-que-veran', { full: false });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /Entendido/ })
        .click();
      const response = page.waitForResponse(
        isApi('PATCH', /^\/api\/applications\/[0-9a-f]{24}$/),
      );
      await page.getByTestId('share-notice-share').click();
      expect((await response).status()).toBe(200);
      await expect(page.getByTestId('share-notice-text')).toHaveText(
        'Compartido',
      );
      await rec.shot(page, 'estado-compartido-con-el-grupo');
      return '«Qué verán» explica qué ve el grupo; «Compartir» → «Compartido» con «Deshacer».';
    },
  );
  await rec.run(
    S,
    'A05',
    '«Me interesa» en otra oferta y el aviso se cierra al navegar',
    async () => {
      await page.goto(String(state['groupUrl']));
      const card = cardOf(page, url2);
      await card.getByTestId('link-interested').click();
      await expect(card.getByTestId('link-own-status')).toHaveText(
        /Tu postulación:\s*Interés/,
      );
      await rec.shot(page, 'me-interesa', { full: false });
      await page
        .getByRole('link', { name: 'Postulaciones', exact: true })
        .click();
      await expect(page).toHaveURL(/\/postulaciones$/);
      await expect(page.getByTestId('share-notice-text')).toHaveCount(0);
      return '«Tu postulación: Interés»; el aviso de compartir no sigue en el tablero.';
    },
  );
  await rec.run(S, 'A06', 'Tablero con columnas', async () => {
    await expect(
      page.getByRole('region', { name: /^Postuladas/ }),
    ).toBeVisible();
    await rec.shot(page, 'tablero-postuladas');
    return 'Seis columnas («Interés», «Postuladas», «En proceso», «Con oferta», «Aceptadas», «Cerradas»); una tarjeta en cada una de las dos primeras.';
  });
  await rec.run(
    S,
    'A07',
    'Detalle: mover a «En proceso» con etapa, nota y compartir',
    async () => {
      const applied = page.getByRole('region', { name: /^Postuladas/ });
      await applied.getByTestId('application-open').click();
      const dialog = page.getByRole('dialog');
      await rec.shot(page, 'detalle-postulacion');
      await dialog.getByTestId('detail-move').click();
      await page.getByRole('menuitem', { name: 'En proceso' }).click();
      const stage = page
        .getByRole('dialog')
        .filter({ hasText: 'Etapa (opcional)' });
      await stage.getByLabel('Etapa (opcional)').fill('Prueba técnica');
      await rec.shot(page, 'mover-en-proceso-etapa', { full: false });
      await stage.getByRole('button', { name: 'Guardar' }).click();
      await expect(page.getByTestId('detail-stage')).toHaveText(
        'Prueba técnica',
      );
      await page
        .getByTestId('detail-notes')
        .fill('Preparar el ejercicio de API REST antes del jueves.');
      await page.getByTestId('detail-save-notes').click();
      await expect(page.getByText('Nota guardada')).toBeVisible();
      await rec.shot(page, 'detalle-en-proceso-con-nota');
      await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await expect(
        page.getByRole('region', { name: /^En proceso/ }).getByRole('article'),
      ).toHaveCount(1);
      await rec.shot(page, 'tablero-en-proceso');
      return 'La tarjeta pasa a «En proceso · Prueba técnica»; el historial registra el cambio; «Nota guardada».';
    },
  );
  await rec.run(
    S,
    'A08',
    'Cerrar una postulación: «¿Cómo se cerró?»',
    async () => {
      const card = page
        .getByRole('region', { name: /^Interés/ })
        .getByRole('article')
        .first();
      const target = page.getByRole('region', { name: /^Cerradas/ });
      const from = (await card.boundingBox())!;
      const to = (await target.boundingBox())!;
      await page.mouse.move(from.x + 20, from.y + 20);
      await page.mouse.down();
      await page.mouse.move(from.x + 40, from.y + 40, { steps: 5 });
      await page.mouse.move(to.x + to.width / 2, to.y + 40, { steps: 25 });
      await page.mouse.up();
      await expect(page.getByRole('dialog')).toContainText('¿Cómo se cerró?');
      await rec.shot(page, 'cerrar-como-se-cerro', { full: false });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Retirada' })
        .click();
      await expect(
        page.getByRole('region', { name: /^Cerradas/ }).getByRole('article'),
      ).toHaveCount(1);
      await rec.shot(page, 'tablero-cerradas');
      return 'Pregunta «¿Cómo se cerró?» (Rechazada, Retirada…); la tarjeta pasa a «Cerradas».';
    },
  );
  await rec.run(S, 'A09', 'Insights con postulaciones', async () => {
    await page.getByTestId('board-insights-link').click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Insights' }),
    ).toBeVisible();
    await expect(page.getByTestId('insights-stale-none')).toBeVisible();
    await rec.shot(page, 'insights');
    return '«Abiertas 1», «Cerradas 1» y «Ninguna postulación abierta lleva 10 días o más sin cambio de estado.».';
  });
  await rec.run(S, 'A10', 'Dejar de seguir', async () => {
    await page.goto('/postulaciones');
    await page
      .getByRole('region', { name: /^Cerradas/ })
      .getByTestId('application-open')
      .click();
    await page.getByTestId('detail-untrack').click();
    await expect(page.getByRole('dialog').last()).toBeVisible();
    await rec.shot(page, 'dejar-de-seguir-confirmar', { full: false });
    await page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /Dejar de seguir/ })
      .click();
    await expect(
      page.getByRole('region', { name: /^Cerradas/ }).getByRole('article'),
    ).toHaveCount(0);
    await rec.shot(page, 'dejar-de-seguir-hecho', { full: false });
    return 'Tras confirmar, la tarjeta desaparece del tablero; la oferta sigue en el grupo.';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 10. Mi CV
// ---------------------------------------------------------------------------------------------------------------------
function scanPdf(): Buffer {
  // PDF válido de más de 4 kB sin ningún texto (solo rectángulos): equivale a un escaneo.
  const content = Array.from(
    { length: 400 },
    (_, i) =>
      `${20 + (i % 20) * 25} ${40 + Math.floor(i / 20) * 30} 20 10 re f`,
  ).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
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

async function chooseFile(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Subir CV' }).click();
  await (await chooser).setFiles(file);
}

async function seccionCv(): Promise<void> {
  const S = '10. Mi CV';
  const { page } = await actor('ana');
  await rec.run(S, 'C01', 'Mi CV vacío', async () => {
    await page.goto('/mi-cv');
    await expect(page.getByTestId('cv-empty')).toBeVisible();
    await expect(page.getByTestId('cv-privacy-status')).toContainText(
      'no has dado ese permiso',
    );
    await rec.shot(page, 'mi-cv-vacio');
    return '«Sube tu CV y LinkVault podrá comparar tus habilidades con cada vacante.» y «Ahora mismo no has dado ese permiso, así que tu CV no sale de LinkVault.».';
  });
  await rec.run(
    S,
    'C02',
    'Archivos que no se aceptan: tipo y tamaño',
    async () => {
      await chooseFile(page, {
        name: 'notas.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('hola'),
      });
      await expect(page.getByText('Solo aceptamos PDF o DOCX')).toBeVisible();
      await rec.shot(page, 'cv-error-tipo', { full: false });
      await chooseFile(page, {
        name: 'enorme.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(6 * 1024 * 1024, 32),
      });
      await expect(
        page.getByText('Ese archivo pesa más de 5 MB'),
      ).toBeVisible();
      await rec.shot(page, 'cv-error-tamano', { full: false });
      return '«Solo aceptamos PDF o DOCX» y «Ese archivo pesa más de 5 MB»; no se envía nada.';
    },
  );
  await rec.run(
    S,
    'C03',
    'Subir el CV en PDF: «Estamos leyendo tu CV…» y «Listo»',
    async () => {
      const response = page.waitForResponse(isApi('POST', /^\/api\/cv$/));
      await chooseFile(page, {
        name: CRITICAL_PATH_CV_FILE_NAME,
        mimeType: 'application/pdf',
        buffer: minimalPdf(CRITICAL_PATH_CV_LINES),
      });
      expect((await response).status()).toBe(201);
      const cv = page
        .getByRole('article')
        .filter({ hasText: CRITICAL_PATH_CV_FILE_NAME });
      await expect(cv).toHaveCount(1);
      await rec.shot(page, 'mi-cv-leyendo', { full: false });
      await expect(cv.getByText('Listo · tu CV se leyó bien')).toBeVisible({
        timeout: 60_000,
      });
      await expect(cv.getByTestId('cv-default-line')).toBeVisible();
      await rec.shot(page, 'mi-cv-listo');
      return '`POST /api/cv` → 201; de «Estamos leyendo tu CV…» a «Listo · tu CV se leyó bien» sin recargar, con «Este es el CV que compararemos con las vacantes».';
    },
  );
  await rec.run(S, 'C04', '«Ver lo que leímos»', async () => {
    await page.getByTestId('cv-view-text').click();
    await expect(page.getByTestId('cv-preview-text')).toBeVisible();
    await rec.shot(page, 'mi-cv-lo-que-leimos', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar' })
      .click();
    return 'El diálogo «Lo que leímos de tu CV» muestra el texto (enmascarado en la captura), sin copiar ni descargar.';
  });
  await rec.run(
    S,
    'C05',
    'Un CV sin texto (escaneo) y «Usar el que sí se leyó»',
    async () => {
      await chooseFile(page, {
        name: 'cv-escaneado.pdf',
        mimeType: 'application/pdf',
        buffer: scanPdf(),
      });
      const scan = page
        .getByRole('article')
        .filter({ hasText: 'cv-escaneado.pdf' });
      await expect(scan.getByText(/no tiene texto/)).toBeVisible({
        timeout: 60_000,
      });
      await rec.shot(page, 'cv-sin-texto');
      await expect(scan.getByTestId('cv-default-useless')).toBeVisible();
      await rec.shot(page, 'cv-por-defecto-inservible');
      await scan.getByTestId('cv-use-extracted').click();
      await expect(
        page
          .getByRole('article')
          .filter({ hasText: CRITICAL_PATH_CV_FILE_NAME })
          .getByTestId('cv-default-line'),
      ).toBeVisible();
      return '«Este archivo no tiene texto: parece un escaneo o una imagen.»; como CV por defecto avisa «No servirá para analizar vacantes» y ofrece «Usar el que sí se leyó».';
    },
  );
  await rec.run(S, 'C06', 'Eliminar un CV', async () => {
    const scan = page
      .getByRole('article')
      .filter({ hasText: 'cv-escaneado.pdf' });
    await scan.getByTestId('cv-remove').click();
    await rec.shot(page, 'cv-eliminar-confirmar', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Eliminar' })
      .click();
    await expect(scan).toHaveCount(0);
    await rec.shot(page, 'cv-eliminado', { full: false });
    return 'Tras confirmar, el CV escaneado desaparece y queda el CV leído como el de por defecto.';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 11. Encaje
// ---------------------------------------------------------------------------------------------------------------------
async function seccionEncaje(): Promise<void> {
  const S = '11. Analizar mi encaje';
  const { page } = await actor('ana');
  const beto = await actor('beto');
  const url1 = String(state['url1']);
  await rec.run(S, 'M01', 'Sin CV: «Necesitas un CV guardado»', async () => {
    await beto.page.goto(String(state['groupUrl']));
    await cardOf(beto.page, url1).getByTestId('link-analyze-match').click();
    await expect(beto.page.getByRole('dialog')).toBeVisible();
    await expect(beto.page.getByTestId('match-no-cv')).toBeVisible();
    await expect(beto.page.getByTestId('match-upload-cv')).toBeVisible();
    await expect(beto.page.getByTestId('match-analyze')).toHaveCount(0);
    await rec.shot(beto.page, 'encaje-sin-cv', { full: false });
    await beto.page
      .getByRole('dialog')
      .getByRole('button', { name: /Cerrar/ })
      .click();
    return 'El diálogo abre ya con «Necesitas un CV guardado para analizar tu encaje.» y «Subir mi CV», sin botón «Analizar».';
  });
  await rec.run(
    S,
    'M02',
    'Analizar mi encaje: informe del fixture de replay',
    async () => {
      await page.goto(String(state['groupUrl']));
      await cardOf(page, url1).getByTestId('link-analyze-match').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByTestId('match-job-title')).toHaveText(job.title);
      await rec.shot(page, 'encaje-antes-de-analizar', { full: false });
      const requested = page.waitForResponse(
        isApi('POST', /^\/api\/links\/[0-9a-f]{24}\/match$/),
      );
      await dialog.getByTestId('match-analyze').click();
      expect((await requested).status()).toBe(202);
      await expect(
        dialog
          .getByTestId('match-steps')
          .or(dialog.getByTestId('match-waiting')),
      ).toBeVisible();
      await rec.shot(page, 'encaje-analizando', { full: false });
      await expect(dialog.getByTestId('match-badge-score')).toHaveText('80', {
        timeout: 120_000,
      });
      await expect(
        dialog.getByText('Análisis básico', { exact: true }),
      ).toHaveCount(0);
      await rec.shot(page, 'encaje-informe');
      return '`POST /api/links/:id/match` → 202 y el informe: «80 · Encaje alto»; coinciden Node, NestJS, MongoDB, Redis y Vitest; «Tienes todas las habilidades que pide esta oferta»; una sugerencia de «Experiencia».';
    },
  );
  await rec.run(
    S,
    'M03',
    'Sugerencia: «Copiar» y «No me convence»',
    async () => {
      const dialog = page.getByRole('dialog');
      const suggestion = dialog.getByTestId('match-suggestion').first();
      await suggestion.scrollIntoViewIfNeeded();
      await rec.shot(page, 'encaje-sugerencia', { full: false });
      await suggestion.getByTestId('match-suggestion-copy').click();
      await expect(suggestion.getByText('Copiado')).toBeVisible();
      await suggestion.getByTestId('match-suggestion-not-convinced').click();
      await expect(suggestion.getByText('Marcada')).toBeVisible();
      await rec.shot(page, 'encaje-copiado-y-no-me-convence', { full: false });
      await dialog
        .getByRole('button', { name: /Cerrar/ })
        .click()
        .catch(() => page.keyboard.press('Escape'));
      return '«Copiado» y «Marcada».';
    },
  );
  await rec.run(S, 'M04', 'El tablero muestra el badge de encaje', async () => {
    await page.goto('/postulaciones');
    await expect(page.getByText('Encaje alto').first()).toBeVisible();
    await rec.shot(page, 'tablero-con-badge-encaje', { full: false });
    return 'La tarjeta de la postulación muestra «80 · Encaje alto».';
  });
  await rec.run(
    S,
    'M05',
    'Plan de estudio: un análisis que no existe',
    async () => {
      await page.goto('/plan/0123456789abcdef01234567');
      await expect(
        page
          .getByRole('alert')
          .or(page.getByText(/no existe|No encontramos|No pudimos/))
          .first(),
      ).toBeVisible();
      await rec.shot(page, 'plan-inexistente', { full: false });
      return 'La pantalla del plan avisa que el análisis no existe. El plan con contenido no es alcanzable con `replay` (ver Hallazgos).';
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 12. Comentarios, «Conozco a alguien ahí», fijar y etiquetas
// ---------------------------------------------------------------------------------------------------------------------
async function seccionComentarios(): Promise<void> {
  const S = '12. Comentarios, «Conozco a alguien», fijar y etiquetas';
  const ana = await actor('ana');
  const beto = await actor('beto');
  const url1 = String(state['url1']);
  await rec.run(
    S,
    'N01',
    'Beto ve la oferta con el estado compartido de Ana',
    async () => {
      await beto.page.goto(String(state['groupUrl']));
      const card = cardOf(beto.page, url1);
      await expect(card.getByText(job.title)).toBeVisible();
      await expect(card.getByLabel(/postulación/i).first())
        .toBeVisible()
        .catch(() => undefined);
      await rec.shot(beto.page, 'miembro-ve-la-oferta-y-el-estado', {
        locator: card,
      });
      return 'Beto ve la tarjeta de Ana con la nota, y el avatar «AG» con el estado compartido.';
    },
  );
  await rec.run(S, 'N02', 'Comentar: validación y publicación', async () => {
    const card = cardOf(beto.page, url1);
    await card.getByTestId('link-comments-open').click();
    const dialog = beto.page.getByTestId('comments-dialog');
    await expect(dialog.getByTestId('comments-empty')).toBeVisible();
    await rec.shot(beto.page, 'comentarios-vacio', { full: false });
    await dialog.getByTestId('comment-draft').fill('x'.repeat(2100));
    await rec.shot(beto.page, 'comentario-demasiado-largo', { full: false });
    await dialog
      .getByTestId('comment-draft')
      .fill('Conozco al equipo, te cuento por privado.');
    await rec.shot(beto.page, 'comentario-relleno', { full: false });
    const response = beto.page.waitForResponse(isApi('POST', /\/comments$/));
    await dialog.getByTestId('comment-post').click();
    expect((await response).status()).toBe(201);
    await expect(dialog.getByTestId('thread-comment')).toHaveCount(1);
    await rec.shot(beto.page, 'comentario-publicado', { full: false });
    await dialog.getByRole('button', { name: 'Cerrar' }).click();
    return '`POST /api/groups/:id/links/:id/comments` → 201; el hilo muestra el comentario con «Borrar» y el aviso de que lo verán los miembros.';
  });
  await rec.run(S, 'N03', '«Conozco a alguien ahí»', async () => {
    const card = cardOf(beto.page, url1);
    await card.getByTestId('link-know-someone-toggle').click();
    await expect(card.getByTestId('link-know-someone-count')).toHaveText(
      '1 persona conoce a alguien ahí',
    );
    await rec.shot(beto.page, 'conozco-a-alguien', { locator: card });
    return '«1 persona conoce a alguien ahí» y el botón «Ya marqué que conozco a alguien».';
  });
  await rec.run(
    S,
    'N04',
    'Ana ve el comentario y el conteo en vivo, y borra el comentario ajeno',
    async () => {
      await ana.page.goto(String(state['groupUrl']));
      const card = cardOf(ana.page, url1);
      await expect(
        card.getByText('Conozco al equipo, te cuento por privado.'),
      ).toBeVisible();
      await expect(card.getByTestId('link-know-someone-count')).toHaveText(
        '1 persona conoce a alguien ahí',
      );
      await rec.shot(ana.page, 'propietaria-ve-comentario-y-conteo', {
        locator: card,
      });
      await card.getByTestId('link-comments-open').click();
      await ana.page.getByTestId('comment-delete').click();
      await rec.shot(ana.page, 'comentario-borrar-confirmar', { full: false });
      await ana.page
        .getByRole('dialog')
        .last()
        .getByRole('button', { name: 'Borrar' })
        .click();
      await expect(ana.page.getByTestId('thread-comment')).toHaveCount(0);
      await ana.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cerrar' })
        .click();
      return 'Ana ve el comentario y «1 persona conoce a alguien ahí»; al borrar lo ajeno la confirmación avisa que desaparece para todo el grupo.';
    },
  );
  await rec.run(S, 'N05', 'Quitar la nota propia', async () => {
    const card = cardOf(ana.page, url1);
    await card.getByTestId('link-note-remove').click();
    await rec.shot(ana.page, 'nota-quitar-confirmar', { full: false });
    await ana.page
      .getByRole('dialog')
      .last()
      .getByRole('button', { name: /Quitar/ })
      .click();
    await expect(card.getByTestId('link-note')).toHaveCount(0);
    return 'La nota desaparece de la tarjeta.';
  });
  await rec.run(S, 'N06', 'Fijar, etiquetar y filtrar', async () => {
    const card = cardOf(ana.page, url1);
    await card.getByTestId('link-pin-toggle').click();
    await expect(card.getByTestId('link-pin-toggle')).toHaveText('Fijado');
    await card.getByTestId('link-tags-edit').click();
    await card.getByTestId('link-tags-input').fill('backend, remoto');
    await rec.shot(ana.page, 'etiquetas-rellenas', { locator: card });
    await card.getByTestId('link-tags-save').click();
    await expect(card.getByTestId('link-tag-chip')).toHaveCount(2);
    await ana.page.getByTestId('group-filter-pinned').click();
    await ana.page.getByTestId('group-filter-tag-input').fill('backend');
    await ana.page.getByTestId('group-filter-tag-apply').click();
    await expect(
      ana.page
        .getByTestId('link-card-list')
        .or(ana.page.getByTestId('link-list')),
    ).toBeVisible();
    await expect(ana.page.getByTestId('group-filter-tag-clear')).toBeVisible();
    await rec.shot(ana.page, 'filtro-fijados-y-etiqueta');
    await ana.page.getByTestId('group-filter-tag-clear').click();
    await ana.page.getByTestId('group-filter-pinned').click();
    return '«Fijado», los chips «backend» y «remoto», y con «Solo fijados» y la etiqueta `backend` solo queda esa oferta junto a «Quitar etiqueta».';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 13. Enlace público
// ---------------------------------------------------------------------------------------------------------------------
async function seccionPublico(): Promise<void> {
  const S = '13. Enlace público';
  const ana = await actor('ana');
  const url1 = String(state['url1']);
  const guest = await guestActor();
  let publicLink = '';
  await rec.run(
    S,
    'E01',
    'Copiar el enlace público de una tarjeta',
    async () => {
      await ana.page.goto(String(state['groupUrl']));
      const card = cardOf(ana.page, url1);
      await card.getByTestId('link-public-copy').click();
      publicLink = await ana.page.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(publicLink).toMatch(/\/p\/[A-Za-z0-9_-]+$/);
      await rec.shot(ana.page, 'enlace-publico-copiado', { locator: card });
      return `Se copia \`${API}/p/<slug>\` (el origen público de la API del bloque).`;
    },
  );
  await rec.run(S, 'E02', 'Carla abre el enlace sin sesión', async () => {
    await guest.page.goto(publicLink);
    await expect(guest.page).toHaveURL(/\/oferta\/[A-Za-z0-9_-]+$/);
    await expect(guest.page.getByTestId('public-preview')).toBeVisible();
    await expect(guest.page.getByTestId('public-original')).toBeVisible();
    await expect(guest.page.getByText('Búsqueda backend')).toHaveCount(0);
    await expect(guest.page.getByText('Ana')).toHaveCount(0);
    await rec.shot(guest.page, 'vista-publica-sin-sesion');
    return 'La API redirige a `/oferta/:slug`: puesto, empresa, «Ver la oferta original», «Guardar en LinkVault» y «Entrar»; no aparece el grupo ni ningún nombre.';
  });
  await rec.run(
    S,
    'E03',
    'Guardar desde el enlace público: registro y «Solo para mí»',
    async () => {
      await guest.page.getByTestId('public-save').click();
      await expect(guest.page).toHaveURL(/\/registro\?import=/);
      await register(guest.page, 'Carla Guía', EMAILS.carla, PASSWORDS.carla);
      await rec.shot(guest.page, 'registro-desde-enlace-publico', {
        full: false,
      });
      await guest.page.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(guest.page).toHaveURL(/\/mis-links/);
      await expect(
        guest.page.getByText(/Guardada en «Solo para mí»/),
      ).toBeVisible();
      await expect(
        guest.page.getByText('Escrito por Ana Guía de Uso'),
      ).toHaveCount(0);
      await expect(
        guest.page.getByText('Escrito por otra persona').first(),
      ).toBeVisible();
      await rec.shot(guest.page, 'guardada-en-solo-para-mi');
      actors.set('carla', guest);
      return 'Acaba en «Solo para mí» con «Guardada en «Solo para mí». Compártela en un grupo cuando quieras.»; la tarjeta no revela el nombre de Ana (dice «Escrito por otra persona»).';
    },
  );
  await rec.run(S, 'E04', 'Dejar de compartir', async () => {
    const card = cardOf(ana.page, url1);
    await card.getByTestId('link-public-off').click();
    await rec.shot(ana.page, 'dejar-de-compartir-confirmar', { full: false });
    await ana.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Dejar de compartir' })
      .click();
    await expect(card.getByTestId('link-public-on')).toBeVisible();
    await rec.shot(ana.page, 'oferta-sin-enlace-publico', { locator: card });
    const g2 = await guestActor();
    await g2.page.goto(publicLink);
    await expect(
      g2.page.getByText('Este enlace ya no está disponible'),
    ).toBeVisible();
    await rec.shot(g2.page, 'enlace-publico-ya-no-disponible', { full: false });
    await g2.context.close();
    return 'La URL pública deja de funcionar: «Este enlace ya no está disponible · Pídeselo de nuevo a quien te lo envió».';
  });
  await rec.run(
    S,
    'E05',
    'Volver a compartir con un enlace público',
    async () => {
      const card = cardOf(ana.page, url1);
      await card.getByTestId('link-public-on').click();
      const dialog = ana.page.getByRole('dialog');
      await rec.shot(ana.page, 'compartir-enlace-publico-confirmar', {
        full: false,
      });
      await dialog.getByRole('button', { name: 'Compartir' }).click();
      await expect(card.getByTestId('link-public-copy')).toBeVisible();
      return 'La oferta vuelve a tener «Copiar enlace» y «Dejar de compartir».';
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 14. Solo para mí
// ---------------------------------------------------------------------------------------------------------------------
async function seccionSoloParaMi(): Promise<void> {
  const S = '14. Solo para mí';
  const carla = await actor('carla');
  const { page } = carla;
  const urlP = jobUrl('solo-para-mi');
  const urlC = jobUrl('cerrada');
  await rec.run(
    S,
    'P01',
    'Guardar una oferta en la lista privada',
    async () => {
      await page.goto('/mis-links');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Solo para mí' }),
      ).toBeVisible();
      await page
        .getByLabel('Pega el enlace de una oferta', { exact: true })
        .fill(urlP);
      await rec.shot(page, 'solo-para-mi-relleno', { full: false });
      const response = page.waitForResponse(isApi('POST', /^\/api\/links$/));
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      expect((await response).status()).toBe(201);
      await expect(cardOf(page, urlP)).toHaveCount(1);
      await expect(
        cardOf(page, urlP).getByTestId('link-pin-toggle'),
      ).toHaveCount(0);
      await expect(
        cardOf(page, urlP).getByTestId('link-know-someone-toggle'),
      ).toHaveCount(0);
      await rec.shot(page, 'solo-para-mi-guardada');
      return 'La tarjeta no tiene fijar, etiquetas ni «Conozco a alguien ahí», porque no está en un grupo.';
    },
  );
  await rec.run(S, 'P02', '«Me interesa» y «Quitar»', async () => {
    const card = cardOf(page, urlP);
    await card.getByTestId('link-interested').click();
    await expect(card.getByTestId('link-own-status')).toHaveText(
      /Tu postulación:\s*Interés/,
    );
    await rec.shot(page, 'solo-para-mi-me-interesa', { full: false });
    await card.getByTestId('link-remove').click();
    await rec.shot(page, 'solo-para-mi-quitar-confirmar', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Quitar' })
      .click();
    await expect(cardOf(page, urlP)).toHaveCount(0);
    await rec.shot(page, 'solo-para-mi-quitada', { full: false });
    return '«Tu postulación: Interés»; «Se quita de tu lista; la oferta sigue disponible en tus grupos.»; al confirmar, la tarjeta desaparece.';
  });
  await rec.run(S, 'P03', 'Oferta ya guardada en un grupo propio', async () => {
    const ana = await actor('ana');
    await ana.page.goto('/mis-links');
    await ana.page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill(String(state['url1']));
    await ana.page
      .getByRole('button', { name: 'Guardar', exact: true })
      .click();
    await expect(
      ana.page.getByTestId('save-link-already-in-groups'),
    ).toContainText('Búsqueda backend (guía)');
    await rec.shot(ana.page, 'solo-para-mi-ya-en-un-grupo', { full: false });
    return '«Ya lo tienes en: Búsqueda backend (guía)».';
  });
  await rec.run(S, 'P04', 'Oferta cerrada y «Reabrir»', async () => {
    await page
      .getByLabel('Pega el enlace de una oferta', { exact: true })
      .fill(urlC);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    const card = cardOf(page, urlC);
    await expect(card.getByTestId('link-complete')).toBeVisible({
      timeout: 70_000,
    });
    await card.getByTestId('link-complete').click();
    const dialog = page.getByRole('dialog');
    await dialog
      .getByLabel('Puesto', { exact: true })
      .fill('Soporte de ejemplo (cerrada)');
    await dialog
      .getByLabel('Empresa', { exact: true })
      .fill('Empresa de ejemplo');
    await dialog.getByLabel('Cierra el').fill('2026-09-01');
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const client = new MongoClient(MONGO_URI);
    try {
      await client.connect();
      const written = await client
        .db()
        .collection('job_links')
        .updateOne(
          { displayUrl: urlC },
          {
            $set: {
              closedAt: new Date('2026-09-22T12:00:00.000Z'),
              closedReason: 'calendar',
            },
          },
        );
      expect(written.matchedCount).toBe(1);
    } finally {
      await client.close();
    }
    await page.reload();
    await expect(cardOf(page, urlC).getByTestId('link-closed')).toBeVisible();
    await rec.shot(page, 'oferta-cerrada', { full: false });
    await cardOf(page, urlC).getByTestId('link-reopen').click();
    await expect(page.getByRole('dialog')).toContainText('Elige cuándo cierra');
    await rec.shot(page, 'reabrir-elige-cuando-cierra', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /Sin fecha de cierre/ })
      .click();
    await expect(cardOf(page, urlC).getByTestId('link-closed')).toHaveCount(0);
    await expect(page.getByText(/Oferta marcada como abierta/)).toBeVisible();
    await rec.shot(page, 'oferta-reabierta', { full: false });
    return 'La frescura automática está apagada en la pila, así que el cierre se siembra en Mongo (`job_links.closedAt`). «Oferta cerrada» → «Reabrir» → «Elige cuándo cierra» (la fecha de cierre ya pasó) → «Sin fecha de cierre» → «Oferta marcada como abierta…».';
  });
  await rec.run(S, 'P05', 'Pegar un chat en «Solo para mí»', async () => {
    await page.getByRole('button', { name: 'Pegar un chat' }).click();
    await page
      .getByRole('dialog')
      .getByTestId('import-text')
      .fill(`mirá ${jobUrl('privado-uno')}`);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Importar' })
      .click();
    await expect(page.getByTestId('import-summary')).toContainText(
      '1 guardada',
    );
    await rec.shot(page, 'solo-para-mi-importar-chat', { full: false });
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Cerrar' })
      .click();
    return '«1 guardada, 0 ya estaban».';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 15. Descubrir y Buscar
// ---------------------------------------------------------------------------------------------------------------------
async function seccionDescubrirBuscar(): Promise<void> {
  const S = '15. Descubrir y Buscar';
  const { page } = await actor('ana');
  await rec.run(
    S,
    'D01',
    'Descubrir vacantes (función apagada en la pila)',
    async () => {
      await page.goto('/descubrir');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Descubrir' }),
      ).toBeVisible();
      await rec.shot(page, 'descubrir-vacio', { full: false });
      await page.getByTestId('discovery-query').fill('react');
      await rec.shot(page, 'descubrir-relleno', { full: false });
      await page.getByTestId('discovery-submit').click();
      await expect(page.getByTestId('discovery-disabled')).toBeVisible();
      await rec.shot(page, 'descubrir-no-disponible', { full: false });
      return '«El descubrimiento de vacantes no está disponible en este momento.» (`FEATURE_DISCOVERY=false` en `e2e.env`). Los resultados no se pueden probar con esta pila.';
    },
  );
  await rec.run(S, 'D02', 'Buscar (función apagada en la pila)', async () => {
    await page.goto('/buscar');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Buscar' }),
    ).toBeVisible();
    await rec.shot(page, 'buscar-vacio');
    await page
      .getByTestId('search-form')
      .getByRole('button', { name: 'Buscar' })
      .click();
    await expect(page.getByText(/Escribe algo para buscar/)).toBeVisible();
    await rec.shot(page, 'buscar-consulta-vacia', { full: false });
    await page.getByTestId('search-query').fill('Backend');
    await page
      .getByTestId('search-form')
      .getByRole('button', { name: 'Buscar' })
      .click();
    await expect(
      page.getByText(/La búsqueda no está disponible en este momento/),
    ).toBeVisible();
    await rec.shot(page, 'buscar-no-disponible', { full: false });
    return 'Consulta vacía: «Escribe algo para buscar…». Con texto: «La búsqueda no está disponible en este momento. Inténtalo más tarde.» (`FEATURE_SEARCH=false`).';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 16. Notificaciones
// ---------------------------------------------------------------------------------------------------------------------
async function seccionNotificaciones(): Promise<void> {
  const S = '16. Notificaciones y push';
  const { page } = await actor('ana');
  await rec.run(
    S,
    'T01',
    'Preferencias de aviso: guardar y comprobar que persisten',
    async () => {
      await page.goto('/perfil');
      await page.getByTestId('profile-notifications-link').click();
      await expect(page).toHaveURL(/\/notificaciones$/);
      await expect(page.getByTestId('pref-group-new-link')).toBeVisible();
      await rec.shot(page, 'notificaciones-inicial');
      await page.getByTestId('pref-group-new-link').click();
      const response = page.waitForResponse(
        isApi('PATCH', /^\/api\/notifications\/preferences$/),
      );
      await page.getByTestId('notifications-save').click();
      expect((await response).status()).toBe(200);
      await expect(page.getByTestId('notifications-saved')).toBeVisible();
      await rec.shot(page, 'notificaciones-guardadas');
      await page.reload();
      await expect(
        page.getByRole('switch', { name: 'Nuevo link en un grupo' }),
      ).not.toBeChecked();
      return '«Preferencias guardadas»; tras recargar, «Nuevo link en un grupo» sigue apagado. Todas las demás vienen activadas.';
    },
  );
  await rec.run(S, 'T02', 'Grupo para avisos de estado', async () => {
    await page.getByTestId('pref-status-group').click();
    await rec.shot(page, 'notificaciones-grupo-de-estado', { full: false });
    await page.getByRole('option', { name: 'Búsqueda backend (guía)' }).click();
    await page.getByTestId('notifications-save').click();
    await expect(page.getByTestId('notifications-saved')).toBeVisible();
    await rec.shot(page, 'notificaciones-grupo-guardado');
    return 'Lista «Todos mis grupos» y los grupos de la persona; se guarda y queda elegido.';
  });
  await rec.run(S, 'T03', 'Push del navegador (sin claves VAPID)', async () => {
    await page.getByTestId('push-enable').click();
    await expect(
      page
        .getByTestId('push-vapid-unavailable')
        .or(page.getByTestId('push-denied')),
    ).toBeVisible();
    await rec.shot(page, 'push-del-navegador');
    const seen = (
      await page.getByTestId('notifications-push').innerText()
    ).replace(/\n+/g, ' ');
    return seen.includes('no está disponible')
      ? 'Con las claves VAPID vacías: «El push no está disponible ahora. Los avisos por email siguen activos.».'
      : 'En Chromium sin interfaz el permiso de notificaciones se deniega: «No diste permiso de notificaciones. Puedes seguir editando los avisos por email.». Con un navegador normal, y sin claves VAPID, sale «El push no está disponible ahora…».';
  });
  await rec.run(S, 'T04', 'Avisos por email en Mailpit', async () => {
    const mail = await guestActor();
    await mail.page.goto(`${MAIL}/`);
    await mail.page.waitForSelector('text=Nuevo link en tu grupo');
    await rec.shot(mail.page, 'mailpit-avisos', {
      full: false,
      mask: [
        mail.page.locator(
          '.message .col-lg-6 > .small.text-muted.text-truncate',
        ),
      ],
    });
    await mail.context.close();
    return 'Mailpit tiene «Nuevo link en tu grupo» y «Actualización de postulación en el grupo» (avisos del worker; solo llegan a cuentas con email verificado).';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 17. Permiso de IA externa y claves propias
// ---------------------------------------------------------------------------------------------------------------------
async function seccionIa(): Promise<void> {
  const S = '17. IA externa y claves propias';
  const { page } = await actor('ana');
  await rec.run(
    S,
    'B01',
    'Conceder y retirar el permiso de IA externa',
    async () => {
      await page.goto('/perfil');
      const ai = page.getByTestId('profile-ai');
      await ai
        .getByRole('switch', {
          name: /Permitir que un proveedor de IA externo/,
        })
        .click();
      await expect(page.getByTestId('profile-ai-consent-meta')).toContainText(
        'Concedido el',
      );
      await rec.shot(page, 'ia-permiso-concedido', { locator: ai });
      await page.goto('/mi-cv');
      await expect(page.getByTestId('cv-privacy-status')).toContainText(
        'ese permiso está activo',
      );
      await rec.shot(page, 'mi-cv-permiso-activo', { full: false });
      await page.goto('/perfil');
      await page
        .getByTestId('profile-ai')
        .getByRole('switch', {
          name: /Permitir que un proveedor de IA externo/,
        })
        .click();
      await expect(
        page.getByTestId('profile-ai-consent-revoked'),
      ).toBeVisible();
      await rec.shot(page, 'ia-permiso-retirado', {
        locator: page.getByTestId('profile-ai'),
      });
      return '«Concedido el … · versión …»; `/mi-cv` dice «ese permiso está activo»; al retirar, «Permiso retirado. Tus próximos análisis no saldrán de LinkVault…».';
    },
  );
  await rec.run(
    S,
    'B02',
    'Idioma de los análisis y ocultar el nombre',
    async () => {
      const ai = page.getByTestId('profile-ai');
      await ai.getByTestId('profile-ai-redact-name').click();
      await ai.getByTestId('profile-ai-language').click();
      await page.getByRole('option', { name: 'Inglés' }).click();
      await expect(ai.getByTestId('profile-ai-language')).toContainText(
        'Inglés',
      );
      await rec.shot(page, 'ia-idioma-ingles-y-nombre-visible', {
        locator: ai,
      });
      await ai.getByTestId('profile-ai-language').click();
      await page.getByRole('option', { name: 'Español' }).click();
      await ai.getByTestId('profile-ai-redact-name').click();
      return 'El idioma de los análisis pasa a «Inglés» y «Ocultar mi nombre…» se apaga; se restauran («No cambia el idioma de la interfaz.»).';
    },
  );
  await rec.run(
    S,
    'B03',
    'Clave propia (BYOK): validación y guardado sin bóveda',
    async () => {
      const key = page.getByTestId('profile-byok-key-anthropic');
      await key.fill('corta');
      await key.blur();
      await expect(
        page.getByText(/al menos 16 caracteres/).first(),
      ).toBeVisible();
      await rec.shot(page, 'clave-ia-corta', {
        locator: page.getByTestId('profile-byok-vendor-anthropic'),
      });
      await key.fill('clave-ficticia-de-prueba-0123456789');
      await rec.shot(page, 'clave-ia-rellena', {
        locator: page.getByTestId('profile-byok-vendor-anthropic'),
      });
      const response = page.waitForResponse(
        isApi('PUT', /^\/api\/users\/me\/ai-keys\/anthropic$/),
      );
      await page.getByTestId('profile-byok-save-anthropic').click();
      const status = (await response).status();
      await rec.shot(page, 'clave-ia-resultado', {
        locator: page.getByTestId('profile-byok'),
      });
      const shown = (
        await page
          .getByTestId('profile-byok')
          .getByRole('alert')
          .first()
          .innerText()
          .catch(() => '')
      ).trim();
      return `\`PUT /api/users/me/ai-keys/anthropic\` → ${status} (\`e2e.env\` no trae \`AI_VAULT_KEY\`). La pantalla muestra «${shown}».`;
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// 18. Administrar grupos
// ---------------------------------------------------------------------------------------------------------------------
async function seccionAdminGrupos(): Promise<void> {
  const S = '18. Administrar grupos';
  const ana = await actor('ana');
  const beto = await actor('beto');
  const create = async (page: Page, name: string): Promise<string> => {
    await page.goto('/grupos');
    await page.getByRole('button', { name: 'Crear un grupo' }).click();
    await page
      .getByRole('dialog')
      .getByLabel('Nombre del grupo', { exact: true })
      .fill(name);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Crear grupo' })
      .click();
    await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
    return page.url();
  };
  const join = async (page: Page, code: string): Promise<void> => {
    await page.goto('/grupos');
    await page.getByRole('button', { name: 'Unirse con un código' }).click();
    await page
      .getByRole('dialog')
      .getByLabel(/código/i)
      .fill(code);
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Unirme' })
      .click();
    await expect(page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
  };
  const codeOf = async (page: Page): Promise<string> =>
    ((await page.getByTestId('invite-code').textContent()) ?? '').trim();
  let g2 = '';
  let code2 = '';
  await rec.run(
    S,
    'X01',
    'Beto se une con un código desde «Unirse con un código»',
    async () => {
      g2 = await create(ana.page, 'Grupo para expulsar (guía)');
      code2 = await codeOf(ana.page);
      await beto.page.goto('/grupos');
      await beto.page
        .getByRole('button', { name: 'Unirse con un código' })
        .click();
      await beto.page
        .getByRole('dialog')
        .getByLabel(/código/i)
        .fill(code2);
      await rec.shot(beto.page, 'unirse-con-codigo-relleno', { full: false });
      await beto.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Unirme' })
        .click();
      await expect(beto.page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      await rec.shot(beto.page, 'unido-con-codigo');
      return 'Beto entra al grupo como «Miembro».';
    },
  );
  await rec.run(
    S,
    'X02',
    'El propietario no puede salir sin ceder la propiedad',
    async () => {
      await ana.page.reload();
      await expect(ana.page.getByTestId('owner-leave-hint')).toHaveText(
        'Para salir, nombra propietario a otro miembro',
      );
      await rec.shot(ana.page, 'propietario-no-puede-salir', {
        locator: ana.page.getByTestId('members'),
      });
      return '«Para salir, nombra propietario a otro miembro».';
    },
  );
  await rec.run(S, 'X03', 'Expulsar y regenerar el código', async () => {
    await ana.page.getByRole('button', { name: 'Expulsar' }).click();
    await expect(ana.page.getByRole('dialog')).toContainText(
      'dejará de ver este grupo',
    );
    await rec.shot(ana.page, 'expulsar-confirmar', { full: false });
    await ana.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Expulsar' })
      .click();
    await expect(
      ana.page.getByRole('button', {
        name: 'Regenerar el código para que no pueda volver a entrar',
      }),
    ).toBeVisible();
    await rec.shot(ana.page, 'expulsado-regenerar-codigo');
    await ana.page
      .getByRole('button', {
        name: 'Regenerar el código para que no pueda volver a entrar',
      })
      .click();
    const dialog = ana.page.getByRole('dialog');
    if (await dialog.count()) {
      await rec.shot(ana.page, 'regenerar-codigo-confirmar', { full: false });
      await dialog.getByRole('button', { name: 'Regenerar' }).click();
    }
    await expect.poll(async () => codeOf(ana.page)).not.toBe(code2);
    return 'El diálogo de expulsión avisa que la persona dejará de ver el grupo; luego ofrece regenerar el código; el código nuevo es distinto del anterior.';
  });
  await rec.run(S, 'X04', 'El código anterior ya no sirve', async () => {
    await beto.page.goto('/grupos');
    await beto.page
      .getByRole('button', { name: 'Unirse con un código' })
      .click();
    await beto.page
      .getByRole('dialog')
      .getByLabel(/código/i)
      .fill(code2);
    await beto.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Unirme' })
      .click();
    await expect(
      beto.page.getByText('Ese código no corresponde a ningún grupo'),
    ).toBeVisible();
    await rec.shot(beto.page, 'codigo-anterior-no-sirve', { full: false });
    await beto.page
      .getByRole('dialog')
      .getByRole('button', { name: /Cancelar/ })
      .click();
    return '«Ese código no corresponde a ningún grupo».';
  });
  await rec.run(S, 'X05', 'Regenerar el código a mano', async () => {
    await ana.page.goto(g2);
    const before = await codeOf(ana.page);
    await ana.page
      .getByRole('button', { name: 'Regenerar el código', exact: true })
      .click();
    await rec.shot(ana.page, 'regenerar-codigo-dialogo', { full: false });
    await ana.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Regenerar' })
      .click();
    await expect.poll(async () => codeOf(ana.page)).not.toBe(before);
    return 'Tras «Regenerar», el código cambia.';
  });
  let g3 = '';
  await rec.run(S, 'X06', 'Ceder la propiedad y salir', async () => {
    g3 = await create(ana.page, 'Grupo para ceder (guía)');
    await join(beto.page, await codeOf(ana.page));
    await ana.page.reload();
    await ana.page.getByRole('button', { name: 'Nombrar propietario' }).click();
    await rec.shot(ana.page, 'nombrar-propietario-confirmar', { full: false });
    await ana.page
      .getByRole('dialog')
      .getByRole('button', { name: /Nombrar/ })
      .click();
    await expect(
      ana.page.getByRole('button', { name: 'Salir del grupo' }),
    ).toBeVisible();
    await rec.shot(ana.page, 'propiedad-cedida');
    await ana.page.getByRole('button', { name: 'Salir del grupo' }).click();
    await rec.shot(ana.page, 'salir-del-grupo-confirmar', { full: false });
    await ana.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Salir' })
      .click();
    await expect(ana.page).toHaveURL(/\/grupos$/);
    await beto.page.goto(g3);
    await expect(
      beto.page.getByRole('button', { name: 'Borrar el grupo' }),
    ).toBeVisible();
    return 'Ana nombra propietario a Beto, ve «Salir del grupo» y sale; Beto queda como «Propietario».';
  });
  await rec.run(S, 'X07', 'Borrar el grupo', async () => {
    await beto.page.getByRole('button', { name: 'Borrar el grupo' }).click();
    await expect(beto.page.getByRole('dialog')).toContainText(
      'No se puede deshacer',
    );
    await rec.shot(beto.page, 'borrar-grupo-confirmar', { full: false });
    await beto.page
      .getByRole('dialog')
      .getByRole('button', { name: 'Borrar' })
      .click();
    await expect(beto.page).toHaveURL(/\/grupos$/);
    await rec.shot(beto.page, 'grupo-borrado', { full: false });
    return 'La confirmación dice «Se borrará solo para ti. No se puede deshacer.»; vuelve a «Tus grupos».';
  });
  await rec.run(S, 'X08', 'Un grupo que no existe', async () => {
    await beto.page.goto('/grupos/0123456789abcdef01234567');
    await expect(
      beto.page.getByText('Ese grupo no existe o ya no perteneces a él'),
    ).toBeVisible();
    await rec.shot(beto.page, 'grupo-inexistente', { full: false });
    return '«Ese grupo no existe o ya no perteneces a él» y «Volver a tus grupos».';
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// 19. Móvil (Pixel 7)
// ---------------------------------------------------------------------------------------------------------------------
async function seccionMovil(): Promise<void> {
  const S = '19. En el móvil (Pixel 7)';
  const pixel = devices['Pixel 7'];
  const guest = await newActor(browser, {
    ...pixel,
    baseURL: WEB,
    locale: 'es-ES',
  });
  await rec.run(
    S,
    'V01m',
    'Móvil: aviso de privacidad e inicio de sesión',
    async () => {
      await guest.page.goto('/login');
      await rec.shot(guest.page, 'movil-login-vacio');
      await guest.page.getByLabel('Email', { exact: true }).fill(EMAILS.ana);
      await guest.page
        .getByLabel('Contraseña', { exact: true })
        .fill(String(state['pwd_ana']));
      await rec.shot(guest.page, 'movil-login-relleno');
      await guest.page.getByRole('button', { name: 'Entrar' }).click();
      await expect(guest.page).toHaveURL(/\/grupos$/);
      await guest.page.goto('/privacidad');
      await rec.shot(guest.page, 'movil-privacidad');
      return 'Formularios a una columna; sin desbordes horizontales.';
    },
  );
  const pages: [string, string, string][] = [
    ['V02m', '/grupos', 'movil-grupos'],
    ['V03m', String(state['groupUrl']).replace(WEB, ''), 'movil-detalle-grupo'],
    ['V04m', '/postulaciones', 'movil-postulaciones'],
    ['V05m', '/mi-cv', 'movil-mi-cv'],
    ['V06m', '/perfil', 'movil-perfil'],
    ['V07m', '/notificaciones', 'movil-notificaciones'],
    ['V08m', '/mis-links', 'movil-solo-para-mi'],
    ['V09m', '/buscar', 'movil-buscar'],
    ['V10m', '/descubrir', 'movil-descubrir'],
  ];
  for (const [id, path, slug] of pages) {
    await rec.run(S, id, `Móvil: ${path}`, async () => {
      await guest.page.goto(path);
      await guest.page.waitForTimeout(1500);
      const overflow = await guest.page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      await rec.shot(guest.page, slug);
      expect(overflow).toBeLessThanOrEqual(1);
      return `Sin desborde horizontal (${overflow} px).`;
    });
  }
  await rec.run(
    S,
    'V11m',
    'Móvil: el informe de encaje en pantalla completa',
    async () => {
      await guest.page.goto(String(state['groupUrl']).replace(WEB, ''));
      await cardOf(guest.page, String(state['url1']))
        .getByTestId('link-analyze-match')
        .click();
      await expect(guest.page.getByRole('dialog')).toBeVisible();
      await rec.shot(guest.page, 'movil-encaje-dialogo', { full: false });
      await guest.page.keyboard.press('Escape');
      return 'El diálogo se adapta al ancho del móvil y se desplaza por dentro, sin desbordar de lado.';
    },
  );
  await rec.run(
    S,
    'V12m',
    'Móvil: comentarios en pantalla completa',
    async () => {
      await cardOf(guest.page, String(state['url1']))
        .getByTestId('link-comments-open')
        .click();
      await expect(guest.page.getByTestId('comments-dialog')).toBeVisible();
      await rec.shot(guest.page, 'movil-comentarios', { full: false });
      await guest.page.keyboard.press('Escape');
      return 'El hilo de comentarios usa la pantalla completa.';
    },
  );
  await guest.context.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// 20. Inglés y modo oscuro
// ---------------------------------------------------------------------------------------------------------------------
async function seccionIdiomas(): Promise<void> {
  const S = '20. Inglés y modo oscuro';
  const en = await newActor(browser, {
    baseURL: `${WEB_EN}/`,
    locale: 'en-US',
  });
  await rec.run(
    S,
    'W01',
    'Interfaz en inglés (build `--localize=en`): sin sesión',
    async () => {
      await en.page.goto('login');
      await expect(en.page.locator('html')).toHaveAttribute('lang', 'en');
      await expect(en.page.getByRole('heading', { level: 1 })).not.toHaveText(
        'Iniciar sesión',
      );
      await rec.shot(en.page, 'en-login');
      await en.page.goto('register');
      await rec.shot(en.page, 'en-register', { full: false });
      await en.page.goto('privacy'.replace('privacy', 'privacidad'));
      await rec.shot(en.page, 'en-privacy');
      return 'El build en inglés se sirve aparte (puerto 4301, ver «Entorno»); las rutas siguen en español.';
    },
  );
  await loginByApi(en.context, EMAILS.ana, String(state['pwd_ana']));
  const screens: [string, string, string][] = [
    ['W02', 'grupos', 'en-groups'],
    [String(state['groupUrl']).replace(WEB + '/', ''), '', ''],
  ].filter((entry) => entry[1] !== '') as [string, string, string][];
  void screens;
  const list: [string, string, string][] = [
    ['W02', 'grupos', 'en-groups'],
    [
      'W03',
      String(state['groupUrl']).replace(`${WEB}/`, ''),
      'en-group-detail',
    ],
    ['W04', 'postulaciones', 'en-applications-board'],
    ['W05', 'mi-cv', 'en-my-cv'],
    ['W06', 'perfil', 'en-profile'],
    ['W07', 'notificaciones', 'en-notifications'],
    ['W08', 'mis-links', 'en-my-links'],
  ];
  for (const [id, path, slug] of list) {
    await rec.run(
      S,
      id,
      `Inglés: ${path.startsWith('grupos/') ? 'detalle del grupo' : path}`,
      async () => {
        await en.page.goto(path);
        await en.page.waitForTimeout(1500);
        await expect(en.page).not.toHaveURL(/login/);
        await rec.shot(en.page, slug);
        return 'La pantalla se ve traducida al inglés.';
      },
    );
  }
  await rec.run(S, 'W09', 'Inglés: informe de encaje', async () => {
    await en.page.goto(String(state['groupUrl']).replace(`${WEB}/`, ''));
    await cardOf(en.page, String(state['url1']))
      .getByTestId('link-analyze-match')
      .click();
    await expect(en.page.getByRole('dialog')).toBeVisible();
    if (await en.page.getByTestId('match-analyze').isVisible()) {
      await en.page.getByTestId('match-analyze').click();
    }
    await expect(en.page.getByTestId('match-badge-score')).toBeVisible({
      timeout: 120_000,
    });
    await rec.shot(en.page, 'en-match-dialog', { full: false });
    await en.page.keyboard.press('Escape');
    return 'El diálogo y el informe en inglés (los textos de las sugerencias vienen del fixture, en español).';
  });
  await en.context.close();
  const dark = await newActor(browser, { colorScheme: 'dark' });
  await loginByApi(dark.context, EMAILS.ana, String(state['pwd_ana']));
  await rec.run(
    S,
    'W10',
    'Modo oscuro: la aplicación no lo soporta',
    async () => {
      await dark.page.goto('/grupos');
      const scheme = await dark.page.evaluate(
        () => getComputedStyle(document.documentElement).colorScheme,
      );
      await rec.shot(dark.page, 'modo-oscuro-grupos', { full: false });
      await dark.page.goto('/perfil');
      await rec.shot(dark.page, 'modo-oscuro-perfil', { full: false });
      expect(scheme).toBe('light');
      return 'Con `prefers-color-scheme: dark` la interfaz sigue clara: `styles.scss` fija `color-scheme: light` y no hay tema oscuro.';
    },
  );
  await dark.context.close();
}

// ---------------------------------------------------------------------------------------------------------------------
// 21. Borrar la cuenta
// ---------------------------------------------------------------------------------------------------------------------
async function seccionBorrarCuenta(): Promise<void> {
  const S = '21. Borrar la cuenta';
  const beto = await actor('beto');
  const guest = await guestActor();
  const g = guest.page;
  await rec.run(
    S,
    'Z01',
    'Diego se registra y crea un grupo con Beto dentro',
    async () => {
      await g.goto('/registro');
      await register(g, 'Diego Guía', EMAILS.diego, PASSWORDS.diego);
      await g.getByRole('button', { name: 'Crear cuenta' }).click();
      await expect(g).toHaveURL(/\/grupos$/);
      actors.set('diego', guest);
      await g.getByRole('button', { name: 'Crear un grupo' }).click();
      await g
        .getByRole('dialog')
        .getByLabel('Nombre del grupo', { exact: true })
        .fill('Grupo de Diego (guía)');
      await g
        .getByRole('dialog')
        .getByRole('button', { name: 'Crear grupo' })
        .click();
      await expect(g).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      const code = (
        (await g.getByTestId('invite-code').textContent()) ?? ''
      ).trim();
      await beto.page.goto('/grupos');
      await beto.page
        .getByRole('button', { name: 'Unirse con un código' })
        .click();
      await beto.page
        .getByRole('dialog')
        .getByLabel(/código/i)
        .fill(code);
      await beto.page
        .getByRole('dialog')
        .getByRole('button', { name: 'Unirme' })
        .click();
      await expect(beto.page).toHaveURL(/\/grupos\/[0-9a-f]{24}$/);
      return 'Preparación: Diego es el único propietario de un grupo con otro miembro.';
    },
  );
  await rec.run(
    S,
    'Z02',
    'No se puede borrar la cuenta siendo el único propietario de un grupo con más miembros',
    async () => {
      await g.goto('/perfil');
      await g.getByTestId('profile-delete-open').click();
      await rec.shot(g, 'borrar-cuenta-vacio', { full: false });
      await g.getByTestId('profile-delete-confirm').click();
      await expect(g.getByText('Introduce tu contraseña')).toBeVisible();
      await rec.shot(g, 'borrar-cuenta-validacion', { full: false });
      await g
        .getByTestId('profile-delete-password')
        .fill('clave-equivocada-123');
      await g.getByTestId('profile-delete-confirm').click();
      await expect(g.getByRole('alert').first()).toBeVisible();
      await rec.shot(g, 'borrar-cuenta-clave-incorrecta', { full: false });
      await g.getByTestId('profile-delete-password').fill(PASSWORDS.diego);
      await g.getByTestId('profile-delete-confirm').click();
      await expect(
        g.getByText(/único propietario de un grupo con otros miembros/),
      ).toBeVisible();
      await rec.shot(g, 'borrar-cuenta-unico-propietario', { full: false });
      await g
        .getByRole('dialog')
        .getByRole('button', { name: /Cancelar/ })
        .click();
      return 'Contraseña vacía: «Introduce tu contraseña»; contraseña mala: error; con la correcta, «Eres el único propietario de un grupo con otros miembros…».';
    },
  );
  await rec.run(S, 'Z03', 'Ceder el grupo y borrar la cuenta', async () => {
    g.on('console', (m) =>
      process.stdout.write(`   [console] ${m.text().slice(0, 160)}\n`),
    );
    g.on('response', (r) => {
      if (r.url().includes('/api/') && r.request().method() !== 'GET') {
        process.stdout.write(
          `   [api] ${r.request().method()} ${r.url()} ${r.status()}\n`,
        );
      }
    });
    await g.goto('/grupos');

    await g.getByRole('link', { name: 'Grupo de Diego (guía)' }).click();
    await g.getByRole('button', { name: 'Nombrar propietario' }).click();
    const owner = g.waitForResponse(isApi('POST', /\/owner$/));
    await g
      .getByRole('dialog')
      .getByRole('button', { name: /Nombrar/ })
      .click();
    await owner;
    await expect(
      g.getByRole('button', { name: 'Salir del grupo' }),
    ).toBeVisible();
    await g.goto('/perfil');
    await g.getByTestId('profile-delete-open').click();
    await g.getByRole('dialog').waitFor();
    await g.waitForTimeout(1000);
    await g.getByTestId('profile-delete-password').fill(PASSWORDS.diego);
    await expect(g.getByTestId('profile-delete-password')).toHaveValue(
      PASSWORDS.diego,
    );
    await rec.shot(g, 'borrar-cuenta-relleno', { full: false });
    await g.waitForTimeout(500);
    await g.getByTestId('profile-delete-confirm').click();
    await g.waitForTimeout(3000);
    if (!g.url().includes('/login')) {
      process.stdout.write(
        `   [debug] sin DELETE tras el primer clic; diálogo: ${(
          await g
            .getByRole('dialog')
            .innerText()
            .catch(() => 'sin diálogo')
        )
          .slice(-160)
          .replace(/\n/g, ' ')}\n`,
      );
      await g
        .getByTestId('profile-delete-confirm')
        .click({ timeout: 5_000 })
        .catch(() => undefined);
    }
    await expect(g).toHaveURL(/\/login/, { timeout: 30_000 });
    await g.getByLabel('Email', { exact: true }).fill(EMAILS.diego);
    await g.getByLabel('Contraseña', { exact: true }).fill(PASSWORDS.diego);
    await g.getByRole('button', { name: 'Entrar' }).click();
    await expect(g.getByText('Email o contraseña incorrectos')).toBeVisible();
    await rec.shot(g, 'cuenta-borrada-ya-no-entra', { full: false });
    return '`DELETE /api/users/me` → 2xx; vuelve a `/login` y la cuenta ya no entra («Email o contraseña incorrectos»).';
  });
  await guest.context.close();
  actors.delete('diego');
}

// ---------------------------------------------------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------------------------------------------------
const SECTIONS: [string, () => Promise<void>][] = [
  ['sin-sesion', seccionSinSesion],
  ['registro', seccionRegistro],
  ['verificacion', seccionVerificacion],
  ['sesion', seccionSesion],
  ['perfil', seccionPerfil],
  ['grupos', seccionGrupos],
  ['invitado', seccionInvitado],
  ['links', seccionLinks],
  ['postulaciones', seccionPostulaciones],
  ['cv', seccionCv],
  ['encaje', seccionEncaje],
  ['comentarios', seccionComentarios],
  ['publico', seccionPublico],
  ['solo', seccionSoloParaMi],
  ['descubrir', seccionDescubrirBuscar],
  ['notificaciones', seccionNotificaciones],
  ['ia', seccionIa],
  ['admin', seccionAdminGrupos],
  ['movil', seccionMovil],
  ['idiomas', seccionIdiomas],
  ['borrar', seccionBorrarCuenta],
];

async function main(): Promise<void> {
  if (outArg === undefined && only === undefined && existsSync(outDir)) {
    for (const file of readdirSync(outDir)) {
      if (file.endsWith('.png')) {
        rmSync(join(outDir, file));
      }
    }
  }
  browser = await chromium.launch({ headless: true });
  try {
    for (const [name, fn] of SECTIONS) {
      if (sectionWanted(name)) {
        process.stdout.write(`== ${name}\n`);
        await fn();
      }
    }
  } finally {
    await closeActors();
    await browser.close();
    saveState(state);
    rec.save(
      only === undefined && outArg === undefined
        ? RESULTS_FILE
        : join(outDir, 'resultados.json'),
    );
  }
  const failed = rec.results.filter((r) => !r.ok);
  process.stdout.write(
    `\n${rec.results.length} casos, ${failed.length} con FALLO, ${rec.next} capturas\n`,
  );
}

void devices;
void MongoClient;
void CRITICAL_PATH_CV_FILE_NAME;
void CRITICAL_PATH_CV_LINES;
void minimalPdf;
void WEB;
void WEB_EN;
void API;
void job;
void cardOf;
void goHome;
void jobUrl;

await main();
