import { CV_FILE_TYPES, type CvFileType } from '@linkvault/shared';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import {
  createS3Client,
  type S3ConnectionSettings,
} from '../../../infrastructure/storage/s3-client.factory';
import type { CvFileStore } from '../application/ports/cv-file-store.port';

// Implementación de `CV_FILE_STORE` sobre almacenamiento compatible con S3 (el servicio `object-store`; ADR-006,
// ADR-028 §1, ADR-052), con la misma forma que `S3SnapshotStore`: el adaptador real se separa de un `CvFileUploader`
// inyectable para que **ningún test de `api` hable con el almacén**. La comprobación contra el almacén de verdad es un
// paso local del RUNBOOK.
//
// Solo sube. No lee y no borra: leer los bytes es del worker y borrarlos sale de la cola `delete-cv-file`.

/** Lo que el store necesita del almacenamiento. Se inyecta para que ningún test hable con el almacén. */
export interface CvFileUploader {
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface S3CvUploaderOptions extends S3ConnectionSettings {
  readonly bucket: string;
}

/**
 * Subida real, con el cliente de la fábrica de `api` (endpoint, checksums y plazos en un solo sitio; design D3).
 *
 * **Pide el cifrado en cada subida** (`ServerSideEncryption: 'AES256'`; design D17 de `object-store`, decisión del
 * usuario del 2026-09-27). SeaweedFS crea el bucket al recibir un `PutObject` en uno que no existe, y lo crea sin
 * cifrado por defecto: sin la cabecera, un bucket de CV borrado o mal nombrado se recrearía con la siguiente subida y
 * guardaría el CV en claro. El cifrado por defecto del bucket (`provision`, `verify`) sigue siendo obligatorio.
 */
export function createS3CvFileUploader(
  options: S3CvUploaderOptions,
): CvFileUploader {
  const client = createS3Client(options);

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
          ServerSideEncryption: 'AES256',
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
