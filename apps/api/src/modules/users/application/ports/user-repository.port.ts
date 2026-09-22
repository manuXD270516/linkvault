import type { NewUser, User } from '../../domain/user';
import type { ProfileChanges } from '../../domain/user-profile';

// Puerto de persistencia de usuarios (D1 de auth-users). Se inyecta con `{ provide: USER_REPOSITORY, useClass: ... }`.

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  /** Guarda un usuario nuevo. Rechaza con `EmailAlreadyRegistered` si el email normalizado ya existe. */
  create(user: NewUser): Promise<User>;
  /** `email` ya normalizado. */
  findByEmail(email: string): Promise<User | null>;
  /** `null` también si el id no tiene un formato válido. */
  findById(id: string): Promise<User | null>;
  /**
   * Nombre visible de cada id conocido, en una sola consulta. Un id desconocido o con un formato inválido no aparece en
   * el mapa: quien llama decide cómo mostrarlo.
   */
  findDisplayNames(ids: readonly string[]): Promise<Map<string, string>>;
  /** Actualiza de forma atómica solo los campos presentes en `changes`; `null` si el usuario no existe. */
  updateProfile(id: string, changes: ProfileChanges): Promise<User | null>;
  /** Sustituye el hash y fija `passwordChangedAt`; `false` si el usuario no existe. */
  setPasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
    session?: object,
  ): Promise<boolean>;
  /**
   * Marca el email como verificado. `false` si el usuario no existe.
   * `session` opaca para la txn del consumo del token (ADR-034 D14).
   */
  markEmailVerified(id: string, session?: object): Promise<boolean>;
  /** Borra el documento del usuario; `false` si no existía o el id está mal formado. */
  delete(id: string, session?: object): Promise<boolean>;
}
