// Errores de dominio del módulo `notifications` (ADR-035).

export type NotificationsErrorCode =
  | 'group_not_found'
  | 'validation_error'
  | 'vapid_unavailable';

export abstract class NotificationsError extends Error {
  abstract readonly code: NotificationsErrorCode;
}

/** `applicationStatusGroupId` de un grupo del que la persona no es miembro. */
export class NotifyGroupNotAllowed extends NotificationsError {
  override readonly name = 'NotifyGroupNotAllowed';
  readonly code = 'group_not_found' as const;

  constructor() {
    super('Not a member of that group');
  }
}

/** Campo de preferencias inválido (p. ej. groupId mal formado). */
export class InvalidNotificationField extends NotificationsError {
  override readonly name = 'InvalidNotificationField';
  readonly code = 'validation_error' as const;

  constructor(readonly field: string) {
    super(`Invalid notification field "${field}"`);
  }
}

/** Faltan claves VAPID en configuración (503). */
export class VapidUnavailable extends NotificationsError {
  override readonly name = 'VapidUnavailable';
  readonly code = 'vapid_unavailable' as const;

  constructor() {
    super('VAPID keys are not configured');
  }
}
