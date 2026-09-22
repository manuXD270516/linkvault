// Errores de dominio del módulo `applications` (specs applications/tracking y applications/group-visibility). Cada uno
// lleva el código de la API que le corresponde; el filtro de errores de presentación decide el estado HTTP. Nunca
// llevan notas, etapas, fechas ni identificadores de usuario: pueden acabar en un log.

/** Códigos de `apiErrorCodeSchema` que produce el dominio de `applications` (lo comprueba un test). */
export type ApplicationsErrorCode =
  | 'application_not_found'
  | 'application_conflict'
  | 'link_not_found'
  | 'group_not_found'
  | 'validation_error';

export abstract class ApplicationsError extends Error {
  abstract readonly code: ApplicationsErrorCode;
}

/**
 * La postulación no existe, es de otra persona o su identificador está mal formado (404). Los tres casos comparten error
 * y cuerpo: nadie puede comprobar qué postulaciones existen probando identificadores.
 */
export class ApplicationNotFound extends ApplicationsError {
  override readonly name = 'ApplicationNotFound';
  readonly code = 'application_not_found';

  constructor() {
    super('Application not found');
  }
}

/** El estado o la etapa cambiaron desde otra pestaña: la `version` enviada ya no es la actual (409). */
export class ApplicationConflict extends ApplicationsError {
  override readonly name = 'ApplicationConflict';
  readonly code = 'application_conflict';

  constructor() {
    super('The application changed since it was read');
  }
}

/**
 * El link que se quiere seguir no lo ve quien pide, no existe o su identificador está mal formado (404). Responde el
 * mismo `link_not_found` que da `links` para un link ajeno: los dos módulos no se distinguen desde fuera.
 */
export class TrackedLinkNotFound extends ApplicationsError {
  override readonly name = 'TrackedLinkNotFound';
  readonly code = 'link_not_found';

  constructor() {
    super('Link not found');
  }
}

/**
 * Quien pide los estados compartidos de un grupo no es miembro, el grupo no existe o el `:id` está mal formado (404),
 * con el mismo cuerpo que da `groups`.
 */
export class TrackersGroupNotFound extends ApplicationsError {
  override readonly name = 'TrackersGroupNotFound';
  readonly code = 'group_not_found';

  constructor() {
    super('Group not found');
  }
}

/**
 * Campo de la petición que el dominio rechaza (400 `validation_error` nombrando el campo). Defensa en profundidad para
 * la etapa y las notas, que el contrato HTTP ya valida; para `appliedAt` es la única comprobación de "futura", porque
 * solo el dominio tiene el reloj.
 */
export abstract class InvalidApplicationField extends ApplicationsError {
  readonly code = 'validation_error';
  abstract readonly field: 'appliedAt' | 'stageLabel' | 'notes' | 'groupId';
}

/**
 * `appliedAt` posterior a `now + 24 h`, o enviada con un estado que no la admite (D3). El margen existe para que ni una
 * zona horaria adelantada ni un reloj de cliente que va por delante rechacen una fecha legítima.
 */
export class InvalidAppliedAt extends InvalidApplicationField {
  override readonly name = 'InvalidAppliedAt';
  readonly field = 'appliedAt';

  constructor() {
    super('Invalid application date');
  }
}

/** Etapa vacía, de más de 60 caracteres o con un estado distinto de `in_process`. */
export class InvalidStageLabel extends InvalidApplicationField {
  override readonly name = 'InvalidStageLabel';
  readonly field = 'stageLabel';

  constructor() {
    super('Invalid stage label');
  }
}

/** Notas de más de 2000 caracteres. */
export class InvalidNotes extends InvalidApplicationField {
  override readonly name = 'InvalidNotes';
  readonly field = 'notes';

  constructor() {
    super('Invalid notes');
  }
}

/**
 * `groupId` de aviso rechazado: el link no está en ese grupo o el actor no es miembro (ADR-035 D8).
 */
export class InvalidNotifyGroupId extends InvalidApplicationField {
  override readonly name = 'InvalidNotifyGroupId';
  readonly field = 'groupId';

  constructor() {
    super('Invalid notification groupId');
  }
}
