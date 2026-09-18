import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type ClientSession, type Connection, type Model } from 'mongoose';
import type {
  JobLinkRepository,
  ResolvedJobLink,
} from '../application/ports/job-link-repository.port';
import type { TransactionSession } from '../application/ports/transaction-session';
import {
  MAX_ORIGINAL_URLS,
  type JobLink,
  type NewJobLink,
} from '../domain/job-link';
import {
  JOB_LINK_MODEL_NAME,
  jobLinkSchema,
  toLinkObjectId,
  toUserObjectId,
  type JobLinkDocument,
} from './link.schemas';
import { modelOf } from './model-of';

// Adaptador Mongo de JOB_LINK_REPOSITORY (D3 de job-links) sobre la conexión Mongoose de la app
// (`getConnectionToken()`).
//
// - La vacante, su relación con el destino y el evento del outbox se escriben en la misma transacción: el caso de uso
//   recibe la sesión y la reparte (ADR-009).
// - El upsert es por `dedupeKey`: se lee primero para no repetir una URL que ya estaba en el historial, y el `$slice`
//   acota el array a las 20 últimas. Sin él, una plataforma reconocida con un parámetro aleatorio haría crecer el
//   documento hasta los 16 MB y lo dejaría inescribible.
// - Un alta simultánea de la misma URL choca con el índice único. Ese error NO es transitorio: aborta la transacción y
//   no se puede continuar sobre la misma sesión, así que el reintento es de la transacción **entera**; en el segundo
//   intento el documento ya existe y solo se añade la URL (D3).

const DUPLICATE_KEY = 11_000;

/** Intentos de la transacción entera: el segundo ya encuentra el documento que ganó la carrera. */
export const MAX_RESOLVE_ATTEMPTS = 2;

/** Campos del índice único que rechazó la escritura; vacío si el error no es una clave duplicada. */
function duplicateKeyFields(error: unknown): string[] {
  if (
    !(error instanceof mongo.MongoServerError) ||
    error.code !== DUPLICATE_KEY
  ) {
    return [];
  }
  const pattern: unknown = error['keyPattern'];
  return typeof pattern === 'object' && pattern !== null
    ? Object.keys(pattern)
    : [];
}

@Injectable()
export class MongoJobLinkRepository implements JobLinkRepository {
  private readonly links: Model<JobLinkDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
  ) {
    this.links = modelOf<JobLinkDocument>(
      connection,
      JOB_LINK_MODEL_NAME,
      jobLinkSchema,
    );
  }

  async withResolvedLink<T>(
    draft: NewJobLink,
    work: (resolved: ResolvedJobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_RESOLVE_ATTEMPTS; attempt += 1) {
      try {
        return await this.withTransaction(async (session) => {
          const resolved = await this.resolve(draft, session);
          return await work(resolved, session);
        });
      } catch (error) {
        // Solo se reintenta la carrera de dos escrituras simultáneas (la vacante o su relación con el destino, que
        // también tiene un índice único); cualquier otro fallo sale tal cual.
        if (duplicateKeyFields(error).length === 0) {
          throw error;
        }
        lastError = error;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('The job link could not be resolved');
  }

  async findById(linkId: string): Promise<JobLink | null> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return null;
    }
    const document = await this.links.findById(id).lean().exec();
    return document ? toJobLink(document) : null;
  }

  /** Vacante de la clave: la existente con su historial al día, o una nueva. */
  private async resolve(
    draft: NewJobLink,
    session: ClientSession,
  ): Promise<ResolvedJobLink> {
    const existing = await this.links
      .findOne({ dedupeKey: draft.dedupeKey })
      .session(session)
      .lean()
      .exec();
    if (existing !== null) {
      return { link: await this.remember(existing, draft, session), created: false };
    }
    const created = await this.links.create([toDocument(draft)], { session });
    const document = created[0];
    if (document === undefined) {
      throw new Error('The job link insert returned no document');
    }
    return { link: toJobLink(document.toObject()), created: true };
  }

  /**
   * Añade la URL original al historial si no estaba, conservando las 20 últimas. `displayUrl` no se toca: es del alta y
   * no cambia, así que recortar el historial no cambia el enlace que se abre ni el que se descargará.
   */
  private async remember(
    existing: JobLinkDocument,
    draft: NewJobLink,
    session: ClientSession,
  ): Promise<JobLink> {
    if (existing.originalUrls.includes(draft.displayUrl)) {
      return toJobLink(existing);
    }
    const updated = await this.links
      .findOneAndUpdate(
        { _id: existing._id },
        {
          $push: {
            originalUrls: {
              $each: [draft.displayUrl],
              $slice: -MAX_ORIGINAL_URLS,
            },
          },
          $set: { updatedAt: draft.updatedAt },
        },
        { returnDocument: 'after' },
      )
      .session(session)
      .lean()
      .exec();
    return toJobLink(updated ?? existing);
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

/** Documento de una vacante nueva. Quien la guarda tiene que ser un usuario con id bien formado. */
function toDocument(draft: NewJobLink): Omit<JobLinkDocument, '_id'> {
  const createdBy = toUserObjectId(draft.createdBy);
  if (createdBy === null) {
    throw new Error('A job link needs a well formed creator id');
  }
  return {
    normalizedUrl: draft.normalizedUrl,
    urlHash: draft.urlHash,
    dedupeKey: draft.dedupeKey,
    platform: draft.platform,
    ...(draft.externalJobId === undefined
      ? {}
      : { externalJobId: draft.externalJobId }),
    displayUrl: draft.displayUrl,
    originalUrls: [...draft.originalUrls],
    previewStatus: draft.previewStatus,
    previewVersion: draft.previewVersion,
    createdBy,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  };
}

export function toJobLink(document: JobLinkDocument): JobLink {
  return {
    id: document._id.toHexString(),
    normalizedUrl: document.normalizedUrl,
    urlHash: document.urlHash,
    dedupeKey: document.dedupeKey,
    platform: document.platform,
    ...(document.externalJobId === undefined
      ? {}
      : { externalJobId: document.externalJobId }),
    displayUrl: document.displayUrl,
    originalUrls: [...document.originalUrls],
    previewStatus: document.previewStatus,
    previewVersion: document.previewVersion,
    createdBy: document.createdBy.toHexString(),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
