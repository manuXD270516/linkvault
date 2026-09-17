import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';

// Cookie del refresh token (D5 de auth-users, ADR-012). Solo viaja a `/api/auth`, nunca es legible desde JavaScript y
// no sale del sitio en navegaciones cruzadas salvo las de nivel superior (`SameSite=Lax`).

export const REFRESH_COOKIE_NAME = 'lv_refresh';
/** Prefijo global `/api` más el controlador `auth`: el navegador no envía la cookie a ninguna otra ruta. */
export const REFRESH_COOKIE_PATH = '/api/auth';

/** Atributos con los que se fija o se borra la cookie; el borrado usa los mismos con `maxAge` 0. */
export interface RefreshCookieOptions {
  readonly httpOnly: true;
  readonly sameSite: 'lax';
  readonly path: string;
  readonly secure: boolean;
  /** Segundos. */
  readonly maxAge: number;
}

/** Lo que usan los helpers de la respuesta de Fastify con `@fastify/cookie` registrado. */
export interface RefreshCookieReply {
  setCookie(
    name: string,
    value: string,
    options: RefreshCookieOptions,
  ): unknown;
}

/** Lo que usan los helpers de la petición de Fastify con `@fastify/cookie` registrado. */
export interface RefreshCookieRequest {
  readonly cookies: Readonly<Record<string, string | undefined>>;
}

/** `Secure` solo con `NODE_ENV=production`: en desarrollo el SPA y la API se sirven por http. */
export function isRefreshCookieSecure(nodeEnv: ApiConfig['NODE_ENV']): boolean {
  return nodeEnv === 'production';
}

/** Fija la cookie con `Max-Age` igual a los segundos enteros que faltan para `expiresAt` (nunca negativo). */
export function setRefreshCookie(
  reply: RefreshCookieReply,
  token: string,
  settings: {
    readonly expiresAt: Date;
    readonly now: Date;
    readonly secure: boolean;
  },
): void {
  const maxAge = Math.max(
    0,
    Math.floor((settings.expiresAt.getTime() - settings.now.getTime()) / 1000),
  );
  reply.setCookie(
    REFRESH_COOKIE_NAME,
    token,
    cookieOptions(settings.secure, maxAge),
  );
}

/** Borra la cookie con el mismo `Path` (si no, el navegador la conservaría) y `Max-Age=0`. */
export function clearRefreshCookie(
  reply: RefreshCookieReply,
  settings: { readonly secure: boolean },
): void {
  reply.setCookie(REFRESH_COOKIE_NAME, '', cookieOptions(settings.secure, 0));
}

/** Valor de la cookie, o `undefined` si falta o está vacía. */
export function readRefreshCookie(
  request: RefreshCookieRequest,
): string | undefined {
  const value = request.cookies[REFRESH_COOKIE_NAME];
  return value === undefined || value === '' ? undefined : value;
}

function cookieOptions(secure: boolean, maxAge: number): RefreshCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: REFRESH_COOKIE_PATH,
    secure,
    maxAge,
  };
}
