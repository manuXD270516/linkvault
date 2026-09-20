import type { CvExtractionFailureReason } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type {
  CvRepository,
  CvToExtract,
  ExtractedCvText,
} from '../../application/ports/cv-repository.port';
import {
  CV_DOCUMENT_MODEL_NAME,
  toCvObjectId,
  type CvDocumentDocument,
} from './cv.schemas';

// Adaptador Mongo de `CV_REPOSITORY` en el worker (D8 de cv-upload-extract, ADR-028 §7).
//
// Todo lo interesante está en la **condición de la escritura**: `{ _id, 'extraction.status': 'pending' }`. Es la
// idempotencia de verdad del consumidor, la que no depende de que la cola recuerde el `jobId`; si `modifiedCount` es
// cero, otra ejecución ganó la carrera y este trabajo ya no vale.
//
// No hay transacción y no hace falta: es una sola escritura sobre un solo documento.

@Injectable()
export class MongoCvRepository implements CvRepository {
  constructor(
    @InjectModel(CV_DOCUMENT_MODEL_NAME)
    private readonly cvs: Model<CvDocumentDocument>,
  ) {}

  async findById(cvId: string): Promise<CvToExtract | null> {
    const id = toCvObjectId(cvId);
    if (id === null) {
      return null;
    }
    const found = await this.cvs
      .findById(id, { userId: 1, fileType: 1, 'extraction.status': 1 })
      .lean()
      .exec();
    if (found === null) {
      return null;
    }
    return {
      id: found._id.toHexString(),
      userId: found.userId.toHexString(),
      fileType: found.fileType,
      status: found.extraction.status,
    };
  }

  async saveExtractedText(
    cvId: string,
    result: ExtractedCvText,
  ): Promise<boolean> {
    return await this.writeIfPending(cvId, {
      extractedText: result.text,
      truncated: result.truncated,
      'extraction.status': 'extracted',
      // `textChars` cuenta **lo guardado**, medido por el mismo dominio que recortó el texto: es la invariante
      // `textChars === $strLenCP(extractedText)` de la que depende `complete` en la vista previa.
      'extraction.textChars': result.chars,
      'extraction.extractedAt': result.extractedAt,
    });
  }

  async saveFailure(
    cvId: string,
    reason: CvExtractionFailureReason,
    at: Date,
  ): Promise<boolean> {
    return await this.writeIfPending(cvId, {
      'extraction.status': 'failed',
      'extraction.failureReason': reason,
      'extraction.textChars': 0,
      'extraction.extractedAt': at,
    });
  }

  private async writeIfPending(
    cvId: string,
    set: Record<string, unknown>,
  ): Promise<boolean> {
    const id = toCvObjectId(cvId);
    if (id === null) {
      return false;
    }
    const result = await this.cvs
      .updateOne({ _id: id, 'extraction.status': 'pending' }, { $set: set })
      .exec();
    return result.modifiedCount === 1;
  }
}
