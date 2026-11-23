// Cabeceras de seguridad por defecto de la API (D6 de edge-security-headers, ADR-057).
//
// HSTS no va aquí: lo añade el borde (Traefik, `edge-hsts`), que es quien sabe que la respuesta viaja por HTTPS.

/**
 * Valores por defecto de toda respuesta de la API. La CSP es la de una API JSON: no carga nada, no se encuadra y no
 * admite `<base>` ni formularios. La página pública (`/p/:slug`) trae la suya (ADR-027 §4) y la conserva.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': [
    "default-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; '),
};

/** Lo que el hook usa de la respuesta de Fastify. */
export interface SecurityHeadersReply {
  hasHeader(name: string): boolean;
  header(name: string, value: string): unknown;
}

/**
 * Hook `onSend` de Fastify. Es `async` a propósito: Fastify trata un `onSend` síncrono como de estilo *callback* y
 * espera `done`; uno asíncrono devuelve el `payload` resuelto. Pone cada cabecera solo si la ruta no puso ya la suya, y
 * no toca el cuerpo.
 */
export async function securityHeadersOnSend<Payload>(
  _request: unknown,
  reply: SecurityHeadersReply,
  payload: Payload,
): Promise<Payload> {
  for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
    if (!reply.hasHeader(name)) {
      reply.header(name, value);
    }
  }
  return payload;
}
