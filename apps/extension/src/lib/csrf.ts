/** Cabecera anti-CSRF exigida por la API en todo `POST /api/auth/*` (ADR-020 / ADR-038). */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'linkvault';

export function csrfHeaders(): Record<string, string> {
  return { [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE };
}
