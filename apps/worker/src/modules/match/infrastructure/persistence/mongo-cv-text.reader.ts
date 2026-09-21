import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Schema,
  Types,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import type {
  CvTextRead,
  CvTextReader,
} from '../../application/ports/cv-text-reader.port';

// Lectura del texto del CV desde `cv_documents` (tarea 13.2). Vista mínima: solo lo necesario para `match-cv`.

const CV_MODEL_NAME = 'MatchWorkerCv';
const CV_DOCUMENTS_COLLECTION = 'cv_documents';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

interface CvDocument {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  extraction: { status: string };
  extractedText?: string;
}

const cvSchema = new Schema<CvDocument>(
  {
    userId: { type: Schema.Types.ObjectId, required: true },
    extraction: {
      type: new Schema({ status: { type: String, required: true } }, { _id: false }),
      required: true,
    },
    extractedText: { type: String },
  },
  {
    collection: CV_DOCUMENTS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: false,
  },
);

@Injectable()
export class MongoCvTextReader implements CvTextReader {
  private readonly cvs: Model<CvDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.cvs = modelOf(connection, CV_MODEL_NAME, cvSchema);
  }

  async read(cvId: string, userId: string): Promise<CvTextRead> {
    if (!OBJECT_ID_HEX.test(cvId) || !OBJECT_ID_HEX.test(userId)) {
      return { kind: 'missing' };
    }
    const document = await this.cvs
      .findOne({
        _id: new Types.ObjectId(cvId),
        userId: new Types.ObjectId(userId),
      })
      .lean()
      .exec();
    if (document === null) {
      return { kind: 'missing' };
    }
    const text = document.extractedText?.trim() ?? '';
    if (document.extraction.status !== 'extracted' || text.length === 0) {
      return { kind: 'unreadable' };
    }
    return { kind: 'ready', text };
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
