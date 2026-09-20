import {
  MAX_CV_DOCUMENTS,
  cvFileKey,
  type CvDocument as CvDocumentResponse,
  type CvFileType,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  CvFileTooLarge,
  TooManyCvAttempts,
  TooManyCvDocuments,
  UnsupportedCvFile,
} from '../domain/errors';
import { toCvResponse } from './cv.mapper';
import { CV_CLOCK, type Clock } from './ports/clock.port';
import {
  CV_FILE_STORE,
  type CvFileStore,
} from './ports/cv-file-store.port';
import { CV_LIMITER, type CvLimiter } from './ports/cv-limiter.port';
import {
  CV_REPOSITORY,
  type CvRepository,
} from './ports/cv-repository.port';

/** Archivo que ya pasó la puerta: su tipo lo decidieron sus bytes y su extensión (D2). */
export interface AcceptedCvFile {
  readonly fileName: string;
  readonly fileType: CvFileType;
  readonly bytes: Uint8Array;
}

/**
 * De dónde salen los bytes. Lo cumple el controlador, que lee el cuerpo multipart trozo a trozo, decide el tipo con el
 * **primer trozo** y drena el resto si no cuadra.
 *
 * Se inyecta como una función y no como un objeto ya leído por una razón concreta: así **el caso de uso manda en el
 * orden** de D7 —puerta, contador, recuento, objeto, transacción— sin tener que conocer ni `@fastify/multipart` ni el
 * stream, y las ramas que no guardan nada se prueban con un doble que simplemente lanza.
 *
 * Lanza `UnsupportedCvFile`, `CvFileTooLarge` o `InvalidCvUpload`.
 */
export type ReadCvUpload = () => Promise<AcceptedCvFile>;

/**
 * `POST /api/cv` (spec `cv/documents`, D7 de cv-upload-extract). El orden importa y es este:
 *
 * 1. **leer la parte y pasar la puerta**. Si el archivo no vale, se consume `cv:reject` —y solo ahí— y se responde
 *    `415` o `413`. El de subidas **no se toca**, así que no hay nada que devolver;
 * 2. **contador de subidas**, ya con un archivo admisible en la mano;
 * 3. **contar los CV** de la persona: camino rápido, para no gastar el almacén cuando ya hay cinco;
 * 4. **pedir el identificador y subir el objeto**;
 * 5. **transacción**: recuento de verdad, `version`, apagado del anterior, inserción y `append` del evento.
 *
 * Cualquier fallo entre el paso 2 y el final del 5 **devuelve el intento** de subida: cobrar por algo que no ocurrió
 * sería cobrar dos veces a quien vuelva a intentarlo. El contador de rechazos del paso 1 **nunca se devuelve**: un
 * rechazo ocurrió.
 *
 * El objeto va **antes** que la transacción a propósito: si algo se rompe a mitad queda un objeto que ningún documento
 * nombra —invisible, y recogible por el barrido del RUNBOOK— en vez de un documento que dice "tienes un CV" cuyo
 * archivo no existe.
 */
@Injectable()
export class UploadCv {
  constructor(
    @Inject(CV_REPOSITORY) private readonly repository: CvRepository,
    @Inject(CV_FILE_STORE) private readonly files: CvFileStore,
    @Inject(CV_LIMITER) private readonly limiter: CvLimiter,
    @Inject(CV_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    read: ReadCvUpload,
  ): Promise<CvDocumentResponse> {
    const file = await this.readOrCount(userId, read);
    await this.takeUploadAttempt(userId);
    try {
      if ((await this.repository.countOf(userId)) >= MAX_CV_DOCUMENTS) {
        throw new TooManyCvDocuments();
      }
      const cvId = this.repository.nextId();
      await this.files.put(
        cvFileKey(userId, cvId),
        file.bytes,
        file.fileType,
      );
      const saved = await this.repository.insertAsDefault({
        id: cvId,
        userId,
        fileKey: cvFileKey(userId, cvId),
        fileName: file.fileName,
        fileType: file.fileType,
        sizeBytes: file.bytes.byteLength,
        uploadedAt: this.clock.now(),
      });
      return toCvResponse(saved);
    } catch (error) {
      // Ni documento, ni evento, ni CV nuevo: el intento vuelve al contador.
      await this.limiter.refund({ kind: 'upload', userId });
      throw error;
    }
  }

  /**
   * Lee el archivo y, si lo rechaza por tipo o por tamaño, cuenta el rechazo. El `413` es la única rama que llega a
   * leer megabytes antes de decir que no, así que es la que más falta hace contar: sin eso, una ráfaga de archivos de
   * 6 MiB no tendría techo ninguno.
   */
  private async readOrCount(
    userId: string,
    read: ReadCvUpload,
  ): Promise<AcceptedCvFile> {
    try {
      return await read();
    } catch (error) {
      if (
        error instanceof UnsupportedCvFile ||
        error instanceof CvFileTooLarge
      ) {
        const decision = await this.limiter.consume({
          kind: 'reject',
          userId,
        });
        if (!decision.allowed) {
          throw new TooManyCvAttempts(decision.retryAfterSeconds);
        }
      }
      throw error;
    }
  }

  private async takeUploadAttempt(userId: string): Promise<void> {
    const decision = await this.limiter.consume({ kind: 'upload', userId });
    if (!decision.allowed) {
      throw new TooManyCvAttempts(decision.retryAfterSeconds);
    }
  }
}
