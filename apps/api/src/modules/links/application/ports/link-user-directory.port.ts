// Puerto de lo que `links` necesita saber de un usuario (D1 de job-links, D2 de paste-job-description): el nombre visible
// de quien compartió, escribió o pegó, y el consentimiento de IA de quien pega. `links` NO lee la colección `users` ni
// importa su dominio (ADR-020 §6): el adaptador de producción va sobre `UsersFacade`. El email nunca sale de `users`.

export const LINK_USER_DIRECTORY = Symbol('LINK_USER_DIRECTORY');

/** Consentimiento de IA de un usuario: si sus datos personales pueden ir a un proveedor externo. */
export interface LinkUserAiConsent {
  readonly externalProviders: boolean;
}

export interface LinkUserDirectory {
  /**
   * Nombre visible de cada id conocido, en una sola consulta. Un id sin entrada no aparece en el mapa: el mapeo lo
   * resuelve como "Usuario", de forma defensiva.
   */
  displayNamesOf(userIds: readonly string[]): Promise<Map<string, string>>;

  /**
   * Consentimiento de IA de ese usuario, leído de su perfil. Un usuario que no existe responde sin permiso: es el valor
   * seguro, y nunca se sustituye por un `false` fijo, que cumpliría "sin consentimiento" sin leer lo que eligió.
   */
  aiConsentOf(userId: string): Promise<LinkUserAiConsent>;
}
