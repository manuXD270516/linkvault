import { EmailAlreadyRegistered } from '../../domain/errors';
import {
  applyProfileChanges,
  type NewUser,
  type User,
} from '../../domain/user';
import type { ProfileChanges } from '../../domain/user-profile';
import type { UserRepository } from '../ports/user-repository.port';

// Repositorio en memoria para tests de application (D12 de auth-users). No es un adaptador de producción: el real es
// `MongoUserRepository`. Devuelve copias para que un test no altere el estado guardado por accidente.

export class InMemoryUserRepository implements UserRepository {
  private readonly users = new Map<string, User>();
  private nextId = 1;

  get size(): number {
    return this.users.size;
  }

  create(user: NewUser): Promise<User> {
    for (const existing of this.users.values()) {
      if (existing.email === user.email) {
        return Promise.reject(new EmailAlreadyRegistered());
      }
    }
    const id = `user-${this.nextId++}`;
    const stored: User = { ...structuredClone(user), id };
    this.users.set(id, stored);
    return Promise.resolve(structuredClone(stored));
  }

  findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return Promise.resolve(structuredClone(user));
      }
    }
    return Promise.resolve(null);
  }

  findById(id: string): Promise<User | null> {
    const user = this.users.get(id);
    return Promise.resolve(user ? structuredClone(user) : null);
  }

  findDisplayNames(ids: readonly string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const id of new Set(ids)) {
      const user = this.users.get(id);
      if (user) {
        names.set(id, user.profile.displayName);
      }
    }
    return Promise.resolve(names);
  }

  updateProfile(id: string, changes: ProfileChanges): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) {
      return Promise.resolve(null);
    }
    const updated: User = {
      ...user,
      profile: applyProfileChanges(user.profile, structuredClone(changes)),
    };
    this.users.set(id, updated);
    return Promise.resolve(structuredClone(updated));
  }

  setPasswordHash(
    id: string,
    passwordHash: string,
    changedAt: Date,
  ): Promise<boolean> {
    const user = this.users.get(id);
    if (!user) {
      return Promise.resolve(false);
    }
    this.users.set(id, {
      ...user,
      passwordHash,
      passwordChangedAt: new Date(changedAt),
    });
    return Promise.resolve(true);
  }

  delete(id: string, _session?: object): Promise<boolean> {
    return Promise.resolve(this.users.delete(id));
  }
}
