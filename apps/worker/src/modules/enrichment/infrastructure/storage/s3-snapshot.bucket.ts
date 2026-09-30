import {
  DeleteObjectsCommand,
  type DeleteObjectsCommandInput,
  type DeleteObjectsCommandOutput,
  ListObjectsV2Command,
  type ListObjectsV2CommandInput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import {
  createS3Client,
  type S3ConnectionSettings,
} from '../../../../infrastructure/storage/s3-client.factory';
import type {
  SnapshotBucket,
  SnapshotDeletion,
  SnapshotListPage,
  StoredSnapshot,
} from '../../application/ports/snapshot-bucket.port';

// Implementación de `SNAPSHOT_BUCKET` sobre la API S3 (design D7 de `object-store`): `ListObjectsV2` para listar con
// `LastModified` y `DeleteObjects` para borrar por lotes. El cliente sale de la fábrica del `worker` (design D3), y las
// dos órdenes se separan en `SnapshotBucketClient` para que ningún test hable con el almacén.

/** Las dos órdenes S3 que usa el barrido. */
export interface SnapshotBucketClient {
  list(input: ListObjectsV2CommandInput): Promise<ListObjectsV2CommandOutput>;
  deleteObjects(
    input: DeleteObjectsCommandInput,
  ): Promise<DeleteObjectsCommandOutput>;
}

/** Cliente real, con el cliente de la fábrica del `worker`. */
export function createS3SnapshotBucketClient(
  settings: S3ConnectionSettings,
): SnapshotBucketClient {
  const client = createS3Client(settings);
  return {
    list: (input) => client.send(new ListObjectsV2Command(input)),
    deleteObjects: (input) => client.send(new DeleteObjectsCommand(input)),
  };
}

/** Código con que S3 dice, dentro de `DeleteObjects`, que la clave no existe: otra réplica ya la borró. */
const ALREADY_GONE = new Set(['NoSuchKey', 'NotFound']);

export class S3SnapshotBucket implements SnapshotBucket {
  constructor(private readonly client: SnapshotBucketClient) {}

  async listPage(
    bucket: string,
    pageToken: string | null,
  ): Promise<SnapshotListPage> {
    const output = await this.client.list({
      Bucket: bucket,
      ...(pageToken === null ? {} : { ContinuationToken: pageToken }),
    });
    // Un objeto sin clave o sin fecha no se puede juzgar por antigüedad: no entra en el listado, y no se borra.
    const objects = (output.Contents ?? []).flatMap(
      (object): StoredSnapshot[] =>
        object.Key === undefined || object.LastModified === undefined
          ? []
          : [{ key: object.Key, lastModified: object.LastModified }],
    );
    const next = output.NextContinuationToken;
    return {
      objects,
      nextPageToken:
        output.IsTruncated === true && next !== undefined && next !== ''
          ? next
          : null,
    };
  }

  async deleteMany(
    bucket: string,
    keys: readonly string[],
  ): Promise<readonly SnapshotDeletion[]> {
    if (keys.length === 0) {
      return [];
    }
    // `Quiet`: el almacén solo devuelve los errores; una clave sin error quedó borrada. S3 no da error por una clave
    // que no existe, y si un almacén lo da con `NoSuchKey`, cuenta igual como borrada por otro.
    const output = await this.client.deleteObjects({
      Bucket: bucket,
      Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
    });
    const errors = new Map<string, string>();
    for (const error of output.Errors ?? []) {
      if (error.Key !== undefined) {
        errors.set(error.Key, error.Code ?? 'UnknownError');
      }
    }
    return keys.map((key): SnapshotDeletion => {
      const code = errors.get(key);
      if (code === undefined) {
        return { key, outcome: 'deleted' };
      }
      return ALREADY_GONE.has(code)
        ? { key, outcome: 'already-gone' }
        : { key, outcome: 'failed', code };
    });
  }
}
