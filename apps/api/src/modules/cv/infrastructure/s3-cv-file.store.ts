import { CV_FILE_TYPES, type CvFileType } from '@linkvault/shared';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import type { CvFileStore } from '../application/ports/cv-file-store.port';

// Implementación de `CV_FILE_STORE` sobre almacenamiento compatible con S3 (MinIO en local, cualquier proveedor en
// producción; ADR-006, ADR-028 §1), con la misma forma que `S3SnapshotStore`: el adaptador real se separa de un
// `CvFileUploader` inyectable para que **ningún test de `api` hable con MinIO**. La comprobación contra el almacén de
// verdad es un paso local del RUNBOOK.
//
// Solo sube. No lee y no borra: leer los bytes es del worker y borrarlos sale de la cola `delete-cv-file`.

/** Lo que el store necesita del almacenamiento. Se inyecta para que ningún test hable con MinIO. */
export interface CvFileUploader {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface S3CvUploaderOptions {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

/** Subida real. `forcePathStyle` es lo que MinIO necesita: no sirve buckets como subdominios. */
export function createS3CvFileUploader(
  options: S3CvUploaderOptions,
): CvFileUploader {
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
    put: async (
      key: string,
      body: Uint8Array,
      contentType: string,
    ): Promise<void> => {
      await client.send(
        new PutObjectCommand({
          Bucket: options.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
  };
}

export class S3CvFileStore implements CvFileStore {
  private readonly logger = new Logger(S3CvFileStore.name);

  constructor(private readonly uploader: CvFileUploader) {}

  async put(
    key: string,
    body: Uint8Array,
    fileType: CvFileType,
  ): Promise<void> {
    try {
      await this.uploader.put(key, body, CV_FILE_TYPES[fileType].mimeType);
    } catch (error: unknown) {
      // **Solo el nombre del error.** El mensaje del SDK lleva dentro la clave del objeto, y la clave lleva el
      // identificador de la persona: registrarlo sería filtrar por la puerta de atrás justo lo que D10 prohíbe.
      this.logger.warn(
        `CV file not stored: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw error;
    }
  }
}
