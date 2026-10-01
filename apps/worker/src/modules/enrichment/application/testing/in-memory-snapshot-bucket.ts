import type {
  SnapshotBucket,
  SnapshotDeletion,
  SnapshotListPage,
} from '../ports/snapshot-bucket.port';

// Almacén en memoria con la forma de `SNAPSHOT_BUCKET`, para los tests del barrido. Lista por páginas pequeñas (así el
// caso de uso tiene que seguir el token) y **cede el turno** antes de cada respuesta, de modo que dos barridos
// lanzados a la vez se intercalan de verdad: los dos listan antes de que ninguno borre, que es cuando uno encuentra
// ya borrado lo que el otro borró.

/** Cede el turno al resto de promesas pendientes, como haría una petición de red. */
function yieldTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export class InMemorySnapshotBucket implements SnapshotBucket {
  private readonly buckets = new Map<string, Map<string, Date>>();
  /** Llamadas a `deleteMany`, por bucket, para comprobar que no se tocó el que no se debía. */
  readonly deleteCalls: { bucket: string; keys: readonly string[] }[] = [];
  /** Claves que el almacén rechaza al borrar, con el código que devuelve. */
  readonly failingKeys = new Map<string, string>();

  constructor(private readonly pageSize = 2) {}

  put(bucket: string, key: string, lastModified: Date): void {
    const objects = this.buckets.get(bucket) ?? new Map<string, Date>();
    objects.set(key, lastModified);
    this.buckets.set(bucket, objects);
  }

  keys(bucket: string): string[] {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }

  async listPage(
    bucket: string,
    pageToken: string | null,
  ): Promise<SnapshotListPage> {
    await yieldTurn();
    // Como `ListObjectsV2`: orden por clave y el token es la última clave devuelta.
    const sorted = [...(this.buckets.get(bucket)?.entries() ?? [])]
      .filter(([key]) => pageToken === null || key > pageToken)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const page = sorted.slice(0, this.pageSize);
    const last = page.at(-1);
    return {
      objects: page.map(([key, lastModified]) => ({ key, lastModified })),
      nextPageToken:
        sorted.length > page.length && last !== undefined ? last[0] : null,
    };
  }

  async deleteMany(
    bucket: string,
    keys: readonly string[],
  ): Promise<readonly SnapshotDeletion[]> {
    this.deleteCalls.push({ bucket, keys: [...keys] });
    await yieldTurn();
    const objects = this.buckets.get(bucket);
    return keys.map((key): SnapshotDeletion => {
      const code = this.failingKeys.get(key);
      if (code !== undefined) {
        return { key, outcome: 'failed', code };
      }
      if (objects?.delete(key) === true) {
        return { key, outcome: 'deleted' };
      }
      return { key, outcome: 'already-gone' };
    });
  }
}
