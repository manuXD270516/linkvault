/**
 * Cliente que abrió la familia de sesión (ADR-038). Legacy sin campo en Mongo ≡ `web`.
 * Refresh web solo cookie + `web`; refresh extensión solo body + `extension`.
 */
export type SessionClient = 'web' | 'extension';

export const SESSION_CLIENTS = ['web', 'extension'] as const satisfies ReadonlyArray<SessionClient>;

/** Normaliza el valor persistido: ausente o desconocido ≡ `web`. */
export function resolveSessionClient(
  client: SessionClient | null | undefined,
): SessionClient {
  return client === 'extension' ? 'extension' : 'web';
}
