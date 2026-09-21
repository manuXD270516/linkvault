import type { SkillImportance } from '@linkvault/shared';
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
  JobReader,
  MatchJobForAnalysis,
} from '../../application/ports/job-reader.port';

// Lectura de la oferta desde `job_links` (tarea 13.2). Título + summary + skills → input de `match-cv`.

const JOB_MODEL_NAME = 'MatchWorkerJobLink';
const JOB_LINKS_COLLECTION = 'job_links';
const OBJECT_ID_HEX = /^[0-9a-f]{24}$/i;

interface JobSkillDoc {
  name: string;
  required: boolean;
}

interface JobLinkDocument {
  _id: Types.ObjectId;
  previewVersion: number;
  preview?: {
    title?: string;
    summary?: string;
    skills?: JobSkillDoc[];
  };
}

const jobLinkSchema = new Schema<JobLinkDocument>(
  {
    previewVersion: { type: Number, required: true },
    preview: { type: Schema.Types.Mixed },
  },
  {
    collection: JOB_LINKS_COLLECTION,
    bufferCommands: false,
    versionKey: false,
    strict: false,
  },
);

@Injectable()
export class MongoJobReader implements JobReader {
  private readonly links: Model<JobLinkDocument>;

  constructor(@Inject(getConnectionToken()) connection: Connection) {
    this.links = modelOf(connection, JOB_MODEL_NAME, jobLinkSchema);
  }

  async read(linkId: string): Promise<MatchJobForAnalysis | null> {
    if (!OBJECT_ID_HEX.test(linkId)) {
      return null;
    }
    const document = await this.links
      .findById(new Types.ObjectId(linkId))
      .lean()
      .exec();
    if (document === null) {
      return null;
    }
    const title = document.preview?.title?.trim() ?? '';
    const text = document.preview?.summary?.trim() ?? '';
    if (title.length === 0 && text.length === 0) {
      return null;
    }
    const skills = (document.preview?.skills ?? []).map((skill) => ({
      name: skill.name,
      importance: (skill.required ? 'must' : 'nice') as SkillImportance,
    }));
    return {
      id: document._id.toHexString(),
      previewVersion: document.previewVersion,
      title: title.length > 0 ? title : 'Oferta',
      text: text.length > 0 ? text : title,
      skills,
    };
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
