import {
  CV_TEXT_PREVIEW_CHARS,
  MAX_CV_DOCUMENTS,
  cvDeletedEvent,
  cvTextPreview,
  cvUploadedEvent,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type ClientSession,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import { duplicateKeyIs } from '../../../infrastructure/mongo/duplicate-key';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import { CvDeletionHooks } from '../application/cv-deletion-hooks';
import type {
  CvRepository,
  CvTextPreviewRead,
  NewCvDocument,
} from '../application/ports/cv-repository.port';
import type { CvDocumentEntity } from '../domain/cv-document';
import { promotedAfterRemoval } from '../domain/cv-document';
import { TooManyCvDocuments } from '../domain/errors';
import {
  CV_DEFAULT_KEY,
  CV_DOCUMENT_MODEL_NAME,
  CV_VERSION_COUNTER_MODEL_NAME,
  CV_VERSION_KEY,
  cvDocumentSchema,
  cvVersionCounterSchema,
  toCvObjectId,
  toUserObjectId,
  type CvDocumentDocument,
  type CvVersionCounterDocument,
} from './cv.schemas';

// Adaptador Mongo de CV_REPOSITORY (D3, D4, D7 y D12 de cv-upload-extract) sobre la conexión Mongoose de la app.
//
// Tres cosas que este adaptador hace y ningún otro sitio puede hacer por él:
//
// 1. **Escribir el documento y su evento en la misma transacción** (ADR-009). El caso de uso no ve la sesión.
// 2. **Reintentar las dos claves duplicadas**. Dos subidas simultáneas de la misma persona son dos pestañas o un doble
//    clic, no un error: `CV_VERSION_KEY` pide otro número y `CV_DEFAULT_KEY` rehace el apagado y la inserción. El
//    `500` se reserva para cuando se agotan los tres intentos, que con dos escrituras por vuelta ya es señal de otra
//    cosa.
// 3. **Dejar el texto fuera de toda lectura** salvo la de la vista previa, y esa trae solo su prefijo. La proyección es
//    **por lista explícita**: así un campo nuevo en la colección no se cuela en una respuesta por omisión.

/** Vueltas de la transacción de alta antes de rendirse (D12). */
export const MAX_INSERT_ATTEMPTS = 3;

/** Campos que salen de una lectura normal. Ni `extractedText`, ni `truncated`, ni `fileKey`. */
const LISTING_PROJECTION = {
  userId: 1,
  fileName: 1,
  fileType: 1,
  sizeBytes: 1,
  version: 1,
  isDefault: 1,
  uploadedAt: 1,
  extraction: 1,
} as const;

/**
 * Proyección de la vista previa (D6, tarea 4.9). Pide **un carácter más** que el límite, que es lo que permite al corte
 * en límite de palabra saber que había más, y mide el texto guardado con `$strLenCP` **en la misma consulta**: leer
 * `extraction.textChars` sería fiarse de un número escrito en otro momento por otro proceso, y el día que alguien
 * recortara el texto por otro camino, `complete` mentiría sin que nada fallara.
 *
 * Lo que nunca hace es traer `extractedText` entero: 200.000 caracteres en memoria para devolver dos mil.
 */
export function textPreviewProjection(): Record<string, unknown> {
  return {
    status: '$extraction.status',
    prefix: {
      $substrCP: [{ $ifNull: ['$extractedText', ''] }, 0, CV_TEXT_PREVIEW_CHARS + 1],
    },
    storedChars: { $strLenCP: { $ifNull: ['$extractedText', ''] } },
  };
}

interface TextPreviewRow {
  status: CvDocumentEntity['extraction']['status'];
  prefix: string;
  storedChars: number;
}

@Injectable()
export class MongoCvRepository implements CvRepository {
  private readonly cvs: Model<CvDocumentDocument>;
  private readonly counters: Model<CvVersionCounterDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    private readonly deletionHooks: CvDeletionHooks,
  ) {
    this.cvs = modelOf(connection, CV_DOCUMENT_MODEL_NAME, cvDocumentSchema);
    this.counters = modelOf(
      connection,
      CV_VERSION_COUNTER_MODEL_NAME,
      cvVersionCounterSchema,
    );
  }

  nextId(): string {
    return new Types.ObjectId().toHexString();
  }

  async countOf(userId: string): Promise<number> {
    const owner = toUserObjectId(userId);
    if (owner === null) {
      return 0;
    }
    return await this.cvs.countDocuments({ userId: owner }).exec();
  }

  async insertAsDefault(document: NewCvDocument): Promise<CvDocumentEntity> {
    const id = toCvObjectId(document.id);
    const owner = toUserObjectId(document.userId);
    if (id === null || owner === null) {
      throw new Error('Saving a CV needs well formed cv and user ids');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
      try {
        return await this.withTransaction(async (session) => {
          // El recuento dentro de la transacción es la verdad; el del caso de uso solo evita gastar el almacén.
          const stored = await this.cvs
            .countDocuments({ userId: owner })
            .session(session)
            .exec();
          if (stored >= MAX_CV_DOCUMENTS) {
            throw new TooManyCvDocuments();
          }
          const version = await this.takeVersion(document.userId, session);
          await this.cvs
            .updateMany(
              { userId: owner, isDefault: true },
              { $set: { isDefault: false } },
            )
            .session(session)
            .exec();
          const [created] = await this.cvs.create(
            [
              {
                _id: id,
                userId: owner,
                fileKey: document.fileKey,
                fileName: document.fileName,
                fileType: document.fileType,
                sizeBytes: document.sizeBytes,
                version,
                isDefault: true,
                uploadedAt: document.uploadedAt,
                extraction: { status: 'pending', textChars: 0 },
              },
            ],
            { session },
          );
          if (created === undefined) {
            throw new Error('The CV insert returned no document');
          }
          await this.outbox.append(
            cvUploadedEvent({ cvId: document.id, userId: document.userId }),
            session,
          );
          return toEntity(created.toObject());
        });
      } catch (error) {
        if (
          !duplicateKeyIs(error, CV_VERSION_KEY) &&
          !duplicateKeyIs(error, CV_DEFAULT_KEY)
        ) {
          throw error;
        }
        // Las dos claves se resuelven igual: otra vuelta entera, que recalcula el número y rehace apagado e inserción.
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('The CV could not be saved');
  }

  async listByUser(userId: string): Promise<CvDocumentEntity[]> {
    const owner = toUserObjectId(userId);
    if (owner === null) {
      return [];
    }
    const documents = await this.cvs
      .find({ userId: owner }, LISTING_PROJECTION)
      .sort({ uploadedAt: -1, version: -1 })
      .lean()
      .exec();
    return documents.map(toEntity);
  }

  async findOwned(
    cvId: string,
    userId: string,
  ): Promise<CvDocumentEntity | null> {
    const ids = ownedIds(cvId, userId);
    if (ids === null) {
      return null;
    }
    const document = await this.cvs
      .findOne(ids, LISTING_PROJECTION)
      .lean()
      .exec();
    return document === null ? null : toEntity(document);
  }

  async setDefault(cvId: string, userId: string): Promise<boolean> {
    const ids = ownedIds(cvId, userId);
    if (ids === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const target = await this.cvs
        .findOne(ids, { _id: 1 })
        .session(session)
        .lean()
        .exec();
      if (target === null) {
        return false;
      }
      // Apagar primero y marcar después: al revés, el índice único parcial rechazaría el segundo marcado.
      await this.cvs
        .updateMany(
          { userId: ids.userId, isDefault: true, _id: { $ne: ids._id } },
          { $set: { isDefault: false } },
        )
        .session(session)
        .exec();
      await this.cvs
        .updateOne(ids, { $set: { isDefault: true } })
        .session(session)
        .exec();
      return true;
    });
  }

  async remove(cvId: string, userId: string): Promise<boolean> {
    const ids = ownedIds(cvId, userId);
    if (ids === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const removed = await this.cvs
        .findOneAndDelete(ids, { projection: LISTING_PROJECTION })
        .session(session)
        .lean()
        .exec();
      if (removed === null) {
        return false;
      }
      const remaining = await this.cvs
        .find({ userId: ids.userId }, LISTING_PROJECTION)
        .session(session)
        .lean()
        .exec();
      if (removed.isDefault) {
        const promoted = promotedAfterRemoval(remaining.map(toEntity));
        if (promoted !== undefined) {
          await this.cvs
            .updateOne(
              { _id: new Types.ObjectId(promoted.id) },
              { $set: { isDefault: true } },
            )
            .session(session)
            .exec();
        }
      }
      if (remaining.length === 0) {
        // Sin CV no hay historia de versiones que respetar: la numeración de esa persona vuelve a empezar en 1.
        await this.counters.deleteOne({ _id: userId }).session(session).exec();
      }
      // ADR-030 §4: los análisis (con texto literal del CV) se purgan **aquí**, en la misma transacción. Un oyente
      // in-process de `cv.deleted` sería un dual-write: si el proceso muere entre el commit y el oyente, los análisis
      // sobrevivirían sin reintento ni rastro.
      await this.deletionHooks.runAll(cvId, userId, session);
      await this.outbox.append(cvDeletedEvent({ cvId, userId }), session);
      return true;
    });
  }

  async textPreviewOf(
    cvId: string,
    userId: string,
  ): Promise<CvTextPreviewRead | null> {
    const ids = ownedIds(cvId, userId);
    if (ids === null) {
      return null;
    }
    const [row] = await this.cvs
      .aggregate<TextPreviewRow>([
        { $match: ids },
        { $project: textPreviewProjection() },
      ])
      .exec();
    if (row === undefined) {
      return null;
    }
    const preview = cvTextPreview(row.prefix);
    return {
      status: row.status,
      text: preview.text,
      chars: preview.chars,
      // Un CV que todavía no está `extracted` no tiene texto **todavía**, así que no está completo: decir `true` sobre
      // una respuesta vacía sonaría a "esto es todo lo que tu CV decía".
      complete:
        row.status === 'extracted' && preview.chars === row.storedChars,
    };
  }

  /**
   * Siguiente versión de esa persona, de su contador y en la misma transacción. El índice único `(userId, version)`
   * sigue siendo la garantía dura: el contador dice qué número pedir, el índice impide que dos documentos lo compartan.
   */
  private async takeVersion(
    userId: string,
    session: ClientSession,
  ): Promise<number> {
    const counter = await this.counters
      .findOneAndUpdate(
        { _id: userId },
        { $inc: { next: 1 } },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: false },
      )
      .session(session)
      .lean()
      .exec();
    // `$inc` sobre un documento nuevo deja `next` en 1, que es justo la primera versión.
    return counter?.next ?? 1;
  }

  private async withTransaction<T>(
    work: (session: ClientSession) => Promise<T>,
  ): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => work(session));
    } finally {
      await session.endSession();
    }
  }
}

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: MongooseSchema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

/** `null` si alguno de los dos identificadores no tiene el formato esperado. */
function ownedIds(
  cvId: string,
  userId: string,
): { _id: Types.ObjectId; userId: Types.ObjectId } | null {
  const id = toCvObjectId(cvId);
  const owner = toUserObjectId(userId);
  return id === null || owner === null ? null : { _id: id, userId: owner };
}

/** Mapeo por **lista explícita**: nunca un `...document`, para que un campo nuevo no viaje por omisión. */
function toEntity(
  document: Pick<
    CvDocumentDocument,
    | '_id'
    | 'userId'
    | 'fileName'
    | 'fileType'
    | 'sizeBytes'
    | 'version'
    | 'isDefault'
    | 'uploadedAt'
    | 'extraction'
  >,
): CvDocumentEntity {
  return {
    id: document._id.toHexString(),
    userId: document.userId.toHexString(),
    fileName: document.fileName,
    fileType: document.fileType,
    sizeBytes: document.sizeBytes,
    version: document.version,
    isDefault: document.isDefault,
    uploadedAt: document.uploadedAt,
    extraction: {
      status: document.extraction.status,
      ...(document.extraction.failureReason === undefined
        ? {}
        : { failureReason: document.extraction.failureReason }),
      textChars: document.extraction.textChars,
      ...(document.extraction.extractedAt === undefined
        ? {}
        : { extractedAt: document.extraction.extractedAt }),
    },
  };
}
