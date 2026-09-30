// Puerto del barrido de snapshots (design D7 de `object-store`): listar un bucket con la fecha de cada objeto y borrar
// por lotes. Solo tipos y el token; lo implementa `S3SnapshotBucket` con la fábrica de cliente del `worker`.
//
// El bucket va en cada llamada, y no en el adaptador, para que sea el caso de uso quien diga **qué** bucket barre: es
// él quien se niega a barrer el de CV, y un adaptador atado a un bucket escondería esa decisión.

export const SNAPSHOT_BUCKET = Symbol('SNAPSHOT_BUCKET');

export interface StoredSnapshot {
  readonly key: string;
  readonly lastModified: Date;
}

export interface SnapshotListPage {
  readonly objects: readonly StoredSnapshot[];
  /** `null` en la última página. */
  readonly nextPageToken: string | null;
}

/**
 * Qué pasó con cada clave de un borrado por lotes:
 * - `deleted`: el almacén lo borró (o lo daba por borrado, que en S3 es lo mismo);
 * - `already-gone`: el almacén dijo que no existía, porque otra réplica lo borró antes;
 * - `failed`: cualquier otro error del almacén, con su código.
 */
export type SnapshotDeletion =
  | { readonly key: string; readonly outcome: 'deleted' | 'already-gone' }
  | { readonly key: string; readonly outcome: 'failed'; readonly code: string };

/** Lo más que se borra en una llamada: el límite de `DeleteObjects` en S3. */
export const SNAPSHOT_DELETE_BATCH = 1000;

export interface SnapshotBucket {
  listPage(bucket: string, pageToken: string | null): Promise<SnapshotListPage>;
  /** Borra hasta `SNAPSHOT_DELETE_BATCH` claves y devuelve el resultado de cada una. */
  deleteMany(
    bucket: string,
    keys: readonly string[],
  ): Promise<readonly SnapshotDeletion[]>;
}
