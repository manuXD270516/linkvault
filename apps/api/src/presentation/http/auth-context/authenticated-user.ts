// Identidad de una petición autenticada (D1 y D3 de auth-users). Vive fuera de los módulos porque la usan la plataforma,
// `users` y `auth`: así ningún módulo importa la presentación de otro.

/** Usuario y sesión del access token verificado por el guard global. */
export interface AuthenticatedUser {
  readonly userId: string;
  readonly sessionId: string;
}

/** Propiedad de la petición de Fastify donde el guard deja la identidad y `@CurrentUser()` la lee. */
export const AUTHENTICATED_USER_PROPERTY = 'authenticatedUser';

/** Lo que el guard y el decorador usan de la petición. */
export interface AuthenticatableRequest {
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  [AUTHENTICATED_USER_PROPERTY]?: AuthenticatedUser;
}
