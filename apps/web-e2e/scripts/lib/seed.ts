/**
 * Siembra de la cuenta del ensayo remoto (change `e2e-suite`, design D3 fase 4 y D5; tarea 4.1). Solo con
 * `--rehearse-remote`, **por la API pública** —nunca por Mongo—, igual que la creará el autor en staging: alta y, si ya
 * existe, un login correcto. Las dos ramas consumen **un intento de registro** (el limitador cuenta antes de crear la
 * cuenta, así que un `409` también cuenta; design D5).
 *
 * Función con el `fetch` inyectado, para que su Vitest recorra las ramas que la pila desechable no puede dar (la cuenta
 * ya existe, el `429` del límite de registros).
 */

export interface SeedAccount {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

/** `registered`: alta nueva (`201`); `existing`: ya existía (`409`) y su contraseña entra (`200`). */
export type SeedOutcome = 'registered' | 'existing';

export interface SeedRequest {
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Lo único que la siembra necesita de `fetch`: el código de estado. */
export type SeedFetch = (url: string, init: SeedRequest) => Promise<{ readonly status: number }>;

/** Cabecera anti-CSRF que el hook de `POST /api/auth/*` exige (ADR-012). */
const CSRF_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'linkvault' } as const;

/**
 * `POST <apiOrigin>/auth/register`; con `409`, `POST <apiOrigin>/auth/login`. Lanza un error que nombra la llamada y su
 * código si la cuenta no queda utilizable. Nunca incluye la contraseña en el mensaje.
 */
export async function seedRehearsalAccount(
  fetchFn: SeedFetch,
  apiOrigin: string,
  account: SeedAccount,
): Promise<SeedOutcome> {
  const base = apiOrigin.endsWith('/') ? apiOrigin : `${apiOrigin}/`;
  const register = await fetchFn(new URL('auth/register', base).href, {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: account.email, password: account.password, displayName: account.displayName }),
  });
  if (register.status === 201) {
    return 'registered';
  }
  if (register.status === 429) {
    throw new Error(
      `POST /api/auth/register answered 429 (too_many_attempts): this IP has spent its registration attempts ` +
        `(10 every 15 minutes, design D5); the rehearsal account ${account.email} was not seeded`,
    );
  }
  if (register.status !== 409) {
    throw new Error(
      `POST /api/auth/register answered ${register.status} for the rehearsal account ${account.email} (expected 201, or 409 if it exists)`,
    );
  }
  const login = await fetchFn(new URL('auth/login', base).href, {
    method: 'POST',
    headers: CSRF_HEADERS,
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  if (login.status === 200) {
    return 'existing';
  }
  throw new Error(
    `the rehearsal account ${account.email} already exists (register 409) and POST /api/auth/login answered ` +
      `${login.status}, not 200: the password of apps/web-e2e/e2e.env does not log in`,
  );
}
