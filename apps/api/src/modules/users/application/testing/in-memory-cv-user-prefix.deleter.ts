import type { CvUserPrefixDeleter } from '../ports/cv-user-prefix-deleter.port';

/** Prefijo en memoria para tests de borrado de cuenta. */
export class InMemoryCvUserPrefixDeleter implements CvUserPrefixDeleter {
  readonly keys = new Set<string>();
  readonly deletedPrefixes: string[] = [];
  failure: Error | undefined;

  withKey(key: string): this {
    this.keys.add(key);
    return this;
  }

  async deleteAllForUser(userId: string): Promise<void> {
    this.deletedPrefixes.push(userId);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    const prefix = `${userId}/`;
    for (const key of [...this.keys]) {
      if (key.startsWith(prefix)) {
        this.keys.delete(key);
      }
    }
  }
}
