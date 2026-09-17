import type { ApiErrorCode } from '@linkvault/shared';
import {
  API_ERROR_STATUS,
  apiErrorBody,
} from '../../../presentation/http/api-error';

// Defensa CSRF de los endpoints de auth (D5 de auth-users, ADR-020 §4). Un formulario o un `fetch` sin preflight de otro
// sitio no puede añadir `X-Requested-With` ni enviar `application/json`; así tampoco se puede forzar un login o un
// registro (login CSRF). El hook corre en `onRequest`, antes del parser de cuerpo, y solo mira cabeceras.

export const CSRF_HEADER_NAME = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'linkvault';
/**
 * Rutas protegidas por el hook: todo `POST` bajo `/api/auth/`. Se compara con la ruta declarada y no con la URL cruda,
 * para que una grafía codificada (`/api/%61uth/login`) que el router decodifica no se salte la comprobación.
 */
export const AUTH_ROUTE_PREFIX = '/api/auth/';

/** Lo que el hook usa de la petición de Fastify. */
export interface AuthHeadersRequest {
  readonly method: string;
  /** `url` es la ruta declarada que casó (sin query ni codificación); ausente si ninguna casó (404). */
  readonly routeOptions: { readonly url?: string };
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
}

/** Lo que el hook usa de la respuesta de Fastify. */
export interface AuthHeadersReply {
  code(statusCode: number): this;
  type(contentType: string): this;
  send(payload: unknown): this;
}

/**
 * Hook `onRequest` de Fastify. Comprueba primero la cabecera (403 `csrf_header_missing`) y después, si la petición lleva
 * cuerpo, el tipo de contenido (415 `unsupported_media_type`). Responde con el cuerpo de error de la API y sin tocar
 * cookies; el resto de peticiones sigue sin cambios.
 */
export async function authHeadersHook<Reply extends AuthHeadersReply>(
  request: AuthHeadersRequest,
  reply: Reply,
): Promise<Reply | undefined> {
  if (
    request.method !== 'POST' ||
    !(request.routeOptions.url ?? '').startsWith(AUTH_ROUTE_PREFIX)
  ) {
    return undefined;
  }
  if (singleHeader(request.headers[CSRF_HEADER_NAME]) !== CSRF_HEADER_VALUE) {
    return reject(reply, 'csrf_header_missing');
  }
  if (hasBody(request.headers) && !isJson(request.headers['content-type'])) {
    return reject(reply, 'unsupported_media_type');
  }
  return undefined;
}

/** Un hook asíncrono que responde debe devolver `reply` para que Fastify no siga con la petición. */
function reject<Reply extends AuthHeadersReply>(
  reply: Reply,
  code: ApiErrorCode,
): Reply {
  return reply
    .code(API_ERROR_STATUS[code])
    .type('application/json')
    .send(apiErrorBody(code));
}

/** Una cabecera repetida no cuenta como válida. */
function singleHeader(
  value: string | string[] | undefined,
): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Hay cuerpo si se anuncia con `Transfer-Encoding` o con un `Content-Length` distinto de 0. */
function hasBody(headers: AuthHeadersRequest['headers']): boolean {
  if (headers['transfer-encoding'] !== undefined) {
    return true;
  }
  const contentLength = singleHeader(headers['content-length']);
  return contentLength !== undefined && contentLength.trim() !== '0';
}

/** `application/json`, con parámetros opcionales como `charset`; sin la cabecera no es JSON. */
function isJson(contentType: string | string[] | undefined): boolean {
  const value = singleHeader(contentType);
  if (value === undefined) {
    return false;
  }
  const [mediaType = ''] = value.split(';');
  return mediaType.trim().toLowerCase() === 'application/json';
}
