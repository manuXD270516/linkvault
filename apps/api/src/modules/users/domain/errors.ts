// Errores de dominio del módulo `users`. Nunca llevan el email, la contraseña ni el hash: pueden acabar en un log.

/** Ya existe un usuario con ese email normalizado. */
export class EmailAlreadyRegistered extends Error {
  override readonly name = 'EmailAlreadyRegistered';

  constructor() {
    super('A user with this email already exists');
  }
}

/** No existe ningún usuario con ese id. */
export class UserNotFound extends Error {
  override readonly name = 'UserNotFound';

  constructor(readonly userId: string) {
    super(`User "${userId}" not found`);
  }
}

/** Cambios de perfil inválidos. `field` nombra el campo, nunca su valor; ausente si el conjunto de cambios está vacío. */
export class InvalidProfileChanges extends Error {
  override readonly name: string = 'InvalidProfileChanges';

  constructor(readonly field?: string) {
    super(
      field === undefined
        ? 'Profile changes must include at least one field'
        : `Invalid profile field "${field}"`,
    );
  }
}

/** `displayName` vacío o de más de 60 caracteres tras eliminar espacios exteriores. */
export class InvalidDisplayName extends InvalidProfileChanges {
  override readonly name = 'InvalidDisplayName';

  constructor() {
    super('displayName');
  }
}

/**
 * La `textVersion` enviada al activar el consentimiento no es la vigente. El perfil no se modifica (D5): el cliente debe
 * mostrar el texto actual y pedir una nueva aceptación.
 */
export class ConsentTextOutdated extends Error {
  override readonly name = 'ConsentTextOutdated';
  readonly code = 'consent_text_outdated' as const;

  constructor() {
    super('The consent text changed; read it again');
  }
}

/**
 * Vault BYOK no disponible fuera de producción (ADR-032 D4). El PUT de claves responde 503 `vault_unavailable`.
 */
export class AiVaultUnavailable extends Error {
  override readonly name = 'AiVaultUnavailable';
  readonly code = 'vault_unavailable' as const;

  constructor() {
    super('AI vault is not configured');
  }
}
