import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { SnapshotStore } from '../../application/ports/snapshot-store.port';

// Implementación de `SNAPSHOT_STORE` sobre almacenamiento compatible con S3 (MinIO en local, cualquier proveedor en
// producción; D12 de link-enrichment).
//
// La compresión es **asíncrona** a propósito (C18): `gzipSync` sobre 300 KB de HTML bloquea el hilo, y con
// `ENRICH_CONCURRENCY` jobs a la vez eso retrasa los latidos del `Worker` lo bastante como para que BullMQ dé un job
// por `stalled` y lo reentregue, que es justo el duplicado que este change existe para evitar.

const gzipAsync = promisify(gzip);

/** Clave del objeto dentro del bucket. El bucket va en la configuración; en el link se guarda solo esta clave. */
export function snapshotKey(linkId: string, previewVersion: number): string {
  return `${linkId}/${previewVersion}.html.gz`;
}

/** Lo que el store necesita del almacenamiento. Se inyecta para que ningún test hable con MinIO. */
export interface SnapshotUploader {
  put(key: string, body: Uint8Array): Promise<void>;
}

export interface S3UploaderOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

/** Subida real. `forcePathStyle` es lo que MinIO necesita: no sirve buckets como subdominios. */
export function createS3SnapshotUploader(
  options: S3UploaderOptions,
): SnapshotUploader {
  const client = new S3Client({
    endpoint: options.endpoint,
    region: options.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: options.accessKey,
      secretAccessKey: options.secretKey,
    },
  });

  return {
    put: async (key: string, body: Uint8Array): Promise<void> => {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: 'text/html',
          ContentEncoding: 'gzip',
        }),
      );
    },
  };
}

export class S3SnapshotStore implements SnapshotStore {
  private readonly logger = new Logger(S3SnapshotStore.name);

  constructor(private readonly uploader: SnapshotUploader) {}

  async save(
    linkId: string,
    previewVersion: number,
    html: string,
  ): Promise<string | null> {
    const key = snapshotKey(linkId, previewVersion);
    try {
      await this.uploader.put(key, await gzipAsync(html));
      return key;
    } catch (error: unknown) {
      // Ni la URL del usuario ni el HTML entran en el registro: solo qué link y qué falló.
      this.logger.warn(
        `snapshot not stored for link ${linkId}: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      return null;
    }
  }
}
