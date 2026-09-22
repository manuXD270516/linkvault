// Puerto de tokens de email de un solo uso (ADR-034 D3/D14). Solo hash en persistencia; el claro solo viaja al correo.

export const EMAIL_TOKEN_REPOSITORY = Symbol('EMAIL_TOKEN_REPOSITORY');

export type EmailTokenPurpose = 'verify_email' | 'reset_password';

export interface IssueEmailToken {
  readonly userId: string;
  readonly purpose: EmailTokenPurpose;
  readonly expiresAt: Date;
  /** Hash SHA-256 del token opaco (hex). */
  readonly tokenHash: string;
}

export interface IssuedEmailToken {
  readonly id: string;
  readonly userId: string;
  readonly purpose: EmailTokenPurpose;
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

export interface ValidEmailToken {
  readonly userId: string;
  readonly purpose: EmailTokenPurpose;
  readonly expiresAt: Date;
}

/**
 * Efecto de negocio dentro de la misma txn Mongo que marca el token usado.
 * `session` es opaco para application (ClientSession en Mongo; ignorado en memoria).
 */
export type EmailTokenConsumeEffect = (
  userId: string,
  session: object | undefined,
) => Promise<void>;

export interface EmailTokenRepository {
  /**
   * Invalida tokens pendientes del mismo purpose/usuario y guarda el nuevo.
   * Rechaza si la escritura falla (el registro captura y sigue con 201).
   */
  issue(input: IssueEmailToken): Promise<IssuedEmailToken>;

  /**
   * Lectura sin consumir: token válido (purpose, no usado, no caducado) o `null`.
   * Sirve para aplicar la política de contraseña antes de revocar/consumir.
   */
  findValid(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
  ): Promise<ValidEmailToken | null>;

  /**
   * Si el hash es válido (purpose, no usado, no caducado), ejecuta `effect` y marca `usedAt`
   * en la misma unidad de commit. Devuelve `invalid` sin efecto si no aplica.
   */
  consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
    effect: EmailTokenConsumeEffect,
  ): Promise<'consumed' | 'invalid'>;

  /** Borra todos los tokens del usuario (cascada de borrado de cuenta). */
  deleteAllForUser(userId: string, session?: object): Promise<number>;
}
