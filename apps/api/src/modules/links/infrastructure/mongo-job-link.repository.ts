import type {
  EnrichmentFailureReason,
  PreviewStatus,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type ClientSession, type Connection, type Model } from 'mongoose';
import type {
  JobLinkRepository,
  ManualPreviewWrite,
  PastedPreviewWrite,
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

  async listByPreviewStatus(
    status: PreviewStatus,
    limit: number,
    reasons?: readonly EnrichmentFailureReason[],
  ): Promise<JobLink[]> {
    if (limit <= 0) {
      return [];
    }
    const documents = await this.links
      .find({
        previewStatus: status,
        ...(reasons === undefined
          ? {}
          : { 'lastEnrichmentError.reason': { $in: [...reasons] } }),
      })
      .sort({ _id: 1 })
      .limit(limit)
      .lean()
      .exec();
    return documents.map(toJobLink);
  }

  async updatePreview(
    linkId: string,
    expectedVersion: number,
    changes: ManualPreviewWrite,
  ): Promise<JobLink | null> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return null;
    }
    // La condición por versión es la que decide la carrera con un enriquecimiento en vuelo: si ya escribió, no casa
    // nada y quien llama vuelve a leer en vez de pisarlo (D2).
    const updated = await this.links
      .findOneAndUpdate(
        { _id: id, previewVersion: expectedVersion },
        {
          $set: {
            preview: changes.preview,
            previewSources: changes.previewSources,
            previewStatus: 'manual',
            updatedAt: changes.now,
          },
          $inc: { previewVersion: 1 },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    return updated === null ? null : toJobLink(updated);
  }

  async writePastedPreview(
    linkId: string,
    expectedVersion: number,
    changes: PastedPreviewWrite,
  ): Promise<JobLink | null> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return null;
    }
    // La misma condición por versión que la edición manual: un enriquecimiento en vuelo que termine después ya no casa,
    // y si fue él quien escribió primero, quien llama vuelve a leer y rehace la mezcla con la misma extracción (D6).
    const updated = await this.links
      .findOneAndUpdate(
        { _id: id, previewVersion: expectedVersion },
        {
          $set: {
            preview: changes.preview,
            previewSources: changes.previewSources,
            previewStatus: changes.previewStatus,
            updatedAt: changes.now,
            ...(changes.lastEnrichmentError === undefined
              ? {}
              : { lastEnrichmentError: changes.lastEnrichmentError }),
          },
          $inc: { previewVersion: 1 },
          ...(changes.lastEnrichmentError === undefined
            ? { $unset: { lastEnrichmentError: '' } }
            : {}),
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    return updated === null ? null : toJobLink(updated);
  }

  async withRequestedEnrichment<T>(
    linkId: string,
    now: Date,
    work: (link: JobLink, session: TransactionSession) => Promise<T>,
  ): Promise<T | null> {
    const id = toLinkObjectId(linkId);
    if (id === null) {
      return null;
    }
    return await this.withTransaction(async (session) => {
      const updated = await this.markRequested(id, now, session);
      return updated === null ? null : await work(updated, session);
    });
  }

  async requestEnrichment(
    linkId: string,
    now: Date,
    session: TransactionSession,
  ): Promise<JobLink | null> {
    const id = toLinkObjectId(linkId);
    return id === null
      ? null
      : await this.markRequested(id, now, session as ClientSession);
  }

  /** Lectura nueva pedida: sube la versión, vuelve a `pending`, apunta cuándo y olvida el fallo anterior. */
  private async markRequested(
    id: NonNullable<ReturnType<typeof toLinkObjectId>>,
    now: Date,
    session: ClientSession,
  ): Promise<JobLink | null> {
    const updated = await this.links
      .findOneAndUpdate(
        { _id: id },
        {
          $set: {
            previewStatus: 'pending',
            previewRequestedAt: now,
            updatedAt: now,
          },
          $inc: { previewVersion: 1 },
          // El motivo del fallo anterior desaparece: el link vuelve a estar en espera, no fallido.
          $unset: { lastEnrichmentError: '' },
        },
        { returnDocument: 'after' },
      )
      .session(session)
      .lean()
      .exec();
    return updated === null ? null : toJobLink(updated);
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
      return {
        link: await this.remember(existing, draft, session),
        created: false,
        urlAdded: !existing.originalUrls.includes(draft.displayUrl),
      };
    }
    const created = await this.links.create([toDocument(draft)], { session });
    const document = created[0];
    if (document === undefined) {
      throw new Error('The job link insert returned no document');
    }
    return {
      link: toJobLink(document.toObject()),
      created: true,
      urlAdded: false,
    };
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
    ...(draft.previewRequestedAt === undefined
      ? {}
      : { previewRequestedAt: draft.previewRequestedAt }),
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
    ...(document.preview === undefined ? {} : { preview: document.preview }),
    ...(document.previewSources === undefined
      ? {}
      : { previewSources: document.previewSources }),
    ...(document.lastEnrichmentError === undefined
      ? {}
      : { lastEnrichmentError: document.lastEnrichmentError }),
    ...(document.previewRequestedAt === undefined
      ? {}
      : { previewRequestedAt: document.previewRequestedAt }),
    createdBy: document.createdBy.toHexString(),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}
