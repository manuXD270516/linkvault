import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import {
  createS3Client,
  type S3ConnectionSettings,
} from '../../../infrastructure/storage/s3-client.factory';
import type { CvUserPrefixDeleter } from '../application/ports/cv-user-prefix-deleter.port';

/** Lo que el borrado de prefijo necesita del almacén. Se inyecta para que los tests no hablen con MinIO. */
export interface CvPrefixObjectStore {
  listKeys(prefix: string): Promise<string[]>;
  deleteKeys(keys: readonly string[]): Promise<void>;
}

export interface S3CvPrefixOptions extends S3ConnectionSettings {
  readonly bucket: string;
}

/** Almacén real, con el cliente de la fábrica de `api` (design D3). */
export function createS3CvPrefixStore(
  options: S3CvPrefixOptions,
): CvPrefixObjectStore {
  const client = createS3Client(options);
  const bucket = options.bucket;

  return {
    listKeys: async (prefix: string): Promise<string[]> => {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: token,
          }),
        );
        for (const object of page.Contents ?? []) {
          if (object.Key !== undefined && object.Key !== '') {
            keys.push(object.Key);
          }
        }
        token =
          page.IsTruncated === true ? page.NextContinuationToken : undefined;
      } while (token !== undefined);
      return keys;
    },
    deleteKeys: async (keys: readonly string[]): Promise<void> => {
      if (keys.length === 0) {
        return;
      }
      // S3 acepta hasta 1000 claves por DeleteObjects.
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await client.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: {
              Objects: chunk.map((Key) => ({ Key })),
              Quiet: true,
            },
          }),
        );
      }
    },
  };
}

export class S3CvUserPrefixDeleter implements CvUserPrefixDeleter {
  private readonly logger = new Logger(S3CvUserPrefixDeleter.name);

  constructor(private readonly store: CvPrefixObjectStore) {}

  async deleteAllForUser(userId: string): Promise<void> {
    const prefix = `${userId}/`;
    try {
      const keys = await this.store.listKeys(prefix);
      await this.store.deleteKeys(keys);
    } catch (error: unknown) {
      this.logger.warn(
        `CV prefix not cleared: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw error;
    }
  }
}
