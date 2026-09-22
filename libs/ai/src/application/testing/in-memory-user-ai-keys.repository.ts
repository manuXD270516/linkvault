import type { AiVendor } from '@linkvault/shared';
import type {
  UpsertUserAiKeyInput,
  UserAiKeyRecord,
  UserAiKeysWriteSession,
  UserAiKeyView,
  UserAiKeysRepository,
} from '../../domain/ports/user-ai-keys.repository.port';

// Doble en memoria para tests del puerto (sin MongoMemoryReplSet).

function keyOf(userId: string, vendor: AiVendor): string {
  return `${userId}\0${vendor}`;
}

export class InMemoryUserAiKeysRepository implements UserAiKeysRepository {
  readonly records = new Map<string, UserAiKeyRecord>();
  /** Sesiones recibidas en `deleteAllKeysForUser` (para comprobar la txn). */
  readonly deleteAllSessions: Array<UserAiKeysWriteSession | undefined> = [];

  async upsert(input: UpsertUserAiKeyInput): Promise<UserAiKeyView> {
    const updatedAt = input.updatedAt ?? new Date();
    const record: UserAiKeyRecord = {
      userId: input.userId,
      vendor: input.vendor,
      ciphertext: Uint8Array.from(input.ciphertext),
      keyHint: input.keyHint,
      updatedAt,
    };
    this.records.set(keyOf(input.userId, input.vendor), record);
    return {
      vendor: record.vendor,
      keyHint: record.keyHint,
      updatedAt: record.updatedAt,
    };
  }

  async listByUser(userId: string): Promise<UserAiKeyView[]> {
    return [...this.records.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .map(({ vendor, keyHint, updatedAt }) => ({ vendor, keyHint, updatedAt }));
  }

  async listRecordsByUser(userId: string): Promise<UserAiKeyRecord[]> {
    return [...this.records.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.vendor.localeCompare(b.vendor))
      .map((r) => ({
        ...r,
        ciphertext: Uint8Array.from(r.ciphertext),
      }));
  }

  async findRecord(
    userId: string,
    vendor: AiVendor,
  ): Promise<UserAiKeyRecord | null> {
    const record = this.records.get(keyOf(userId, vendor));
    if (record === undefined) return null;
    return { ...record, ciphertext: Uint8Array.from(record.ciphertext) };
  }

  async delete(userId: string, vendor: AiVendor): Promise<boolean> {
    return this.records.delete(keyOf(userId, vendor));
  }

  async deleteAllKeysForUser(
    userId: string,
    session?: UserAiKeysWriteSession,
  ): Promise<number> {
    this.deleteAllSessions.push(session);
    let deleted = 0;
    for (const [key, record] of this.records) {
      if (record.userId === userId) {
        this.records.delete(key);
        deleted++;
      }
    }
    return deleted;
  }
}
