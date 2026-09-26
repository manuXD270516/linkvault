import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { Logger } from '@nestjs/common';
import {
  createS3Client,
  type S3ConnectionSettings,
} from '../../../../infrastructure/storage/s3-client.factory';
import type { CvFileReader } from '../../application/ports/cv-file-reader.port';

// Implementación de `CV_FILE_READER` sobre almacenamiento compatible con S3 (ADR-006, ADR-028 §5 y §8), con la misma
// forma que `S3SnapshotStore`: el adaptador real se separa de un cliente inyectable para que ningún test hable con
// MinIO.
//
// El worker es el **único** lector de estos bytes: no hay ninguna ruta de la API que los devuelva.

/** Lo que el lector necesita del almacenamiento. Se inyecta para que ningún test hable con MinIO. */
export interface CvObjectClient {
  /** Bytes del objeto, o `null` si no existe. */
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

export interface S3CvReaderOptions extends S3ConnectionSettings {
  readonly bucket: string;
}

/** Códigos con que S3 y MinIO dicen "ese objeto no está". */
const MISSING_OBJECT = new Set(['NoSuchKey', 'NotFound', 'NoSuchBucket']);

/** `true` si el error del SDK significa que el objeto no existe, y no que el almacén no responda. */
export function meansMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const named = error as {
    name?: unknown;
    $metadata?: { httpStatusCode?: unknown };
  };
  return (
    (typeof named.name === 'string' && MISSING_OBJECT.has(named.name)) ||
    named.$metadata?.httpStatusCode === 404
  );
}

/** Cliente real, con el cliente de la fábrica del `worker` (endpoint, checksums y plazos en un solo sitio; design D3). */
export function createS3CvObjectClient(
  options: S3CvReaderOptions,
): CvObjectClient {
  const client = createS3Client(options);

  return {
    get: async (key: string): Promise<Uint8Array | null> => {
      try {
        const response = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        return (await response.Body?.transformToByteArray()) ?? null;
      } catch (error: unknown) {
        if (meansMissingObject(error)) {
          return null;
        }
        throw error;
      }
    },
    delete: async (key: string): Promise<void> => {
      // `DeleteObject` sobre una clave que no existe responde `204` en S3: borrar lo ya borrado es un acierto.
      await client.send(
        new DeleteObjectCommand({ Bucket: options.bucket, Key: key }),
      );
    },
  };
}

export class S3CvFileReader implements CvFileReader {
  private readonly logger = new Logger(S3CvFileReader.name);

  constructor(private readonly client: CvObjectClient) {}

  async read(key: string): Promise<Uint8Array | null> {
    try {
      return await this.client.get(key);
    } catch (error: unknown) {
      // **Solo el nombre del error.** El mensaje del SDK lleva dentro la clave del objeto, y la clave lleva el
      // identificador de la persona (D10).
      this.logger.warn(
        `CV file not read: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    try {
      await this.client.delete(key);
    } catch (error: unknown) {
      if (meansMissingObject(error)) {
        // Ya no estaba: es exactamente lo que se quería conseguir.
        return;
      }
      this.logger.warn(
        `CV file not deleted: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
      throw error;
    }
  }
}
