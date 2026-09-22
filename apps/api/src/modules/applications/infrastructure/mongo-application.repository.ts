import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  type ClientSession,
  type Connection,
  type Model,
  type Schema,
  type Types,
} from 'mongoose';
import { duplicateKeyIs } from '../../../infrastructure/mongo/duplicate-key';
import type {
  ApplicationRepository,
  SharedApplication,
  TrackResult,
} from '../application/ports/application-repository.port';
import type {
  Application,
  EditWrite,
  StartedTracking,
  StatusWrite,
} from '../domain/application.entity';
import type {
  ApplicationEvent,
  NewApplicationEvent,
} from '../domain/application-event';
import {
  APPLICATION_EVENT_MODEL_NAME,
  APPLICATION_MODEL_NAME,
  applicationEventSchema,
  applicationSchema,
  toApplicationObjectId,
  toLinkObjectId,
  toUserObjectId,
  TRACKING_KEY,
  type ApplicationDocument,
  type ApplicationEventDocument,
} from './application.schemas';

// Adaptador Mongo de APPLICATION_REPOSITORY (D2 y D5 de applications-tracking) sobre la conexión Mongoose de la app
// (`getConnectionToken()`).
//
// - Alta: postulación y primer evento en una transacción. Un 11000 sobre `(userId, linkId)` deja la transacción abortada
//   y no es un `TransientTransactionError`, así que se relee **fuera** de ella y se responde `created: false` (ADR-021
//   §1). Si la relectura no encuentra nada —otra pestaña dejó de seguirla entre el choque y la relectura—, se repite la
//   transacción de alta una vez; si vuelve a pasar, el error sube.
// - Cambio de estado: `updateOne` condicionado por `_id`, `userId` y `version`, y el evento solo si `modifiedCount === 1`,
//   en la misma transacción: nunca un evento de un cambio que no ocurrió.
// - Dejar de seguir: `deleteOne({ _id, userId })` y `deleteMany({ applicationId })` en una transacción, sin tocar los
//   eventos si no se borró nada.
// - Un identificador mal formado no llega a Mongo: responde `null`, `false` o nada, nunca CastError.
// - Ningún `$set` escribe puntuación: `fitScore` no vive en el documento (D11).

/** Intentos de la transacción de alta: el segundo solo si la relectura tras el choque no encontró nada (D5). */
export const MAX_TRACK_ATTEMPTS = 2;

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

@Injectable()
export class MongoApplicationRepository implements ApplicationRepository {
  private readonly applications: Model<ApplicationDocument>;
  private readonly events: Model<ApplicationEventDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
  ) {
    this.applications = modelOf<ApplicationDocument>(
      connection,
      APPLICATION_MODEL_NAME,
      applicationSchema,
    );
    this.events = modelOf<ApplicationEventDocument>(
      connection,
      APPLICATION_EVENT_MODEL_NAME,
      applicationEventSchema,
    );
  }

  async create(tracking: StartedTracking): Promise<TrackResult> {
    const userId = toUserObjectId(tracking.application.userId);
    const linkId = toLinkObjectId(tracking.application.linkId);
    if (userId === null || linkId === null) {
      throw new Error('Tracking a link needs well formed user and link ids');
    }
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_TRACK_ATTEMPTS; attempt += 1) {
      try {
        return await this.withTransaction(async (session) => {
          const created = await this.applications.create(
            [toDocument(tracking, userId, linkId)],
            { session },
          );
          const document = created[0];
          if (document === undefined) {
            throw new Error('The application insert returned no document');
          }
          await this.insertEvent(document._id, userId, tracking.event, session);
          return {
            application: toApplication(document.toObject()),
            created: true,
          };
        });
      } catch (error) {
        if (!duplicateKeyIs(error, TRACKING_KEY)) {
          throw error;
        }
        lastError = error;
        // La transacción abortó y no se puede continuar: se relee fuera de ella.
        const existing = await this.findExisting(userId, linkId);
        if (existing !== null) {
          return { application: existing, created: false };
        }
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('The application could not be created');
  }

  async findOwned(
    applicationId: string,
    userId: string,
  ): Promise<Application | null> {
    const ids = ownedIds(applicationId, userId);
    if (ids === null) {
      return null;
    }
    const document = await this.applications.findOne(ids).lean().exec();
    return document ? toApplication(document) : null;
  }

  async changeStatus(
    applicationId: string,
    userId: string,
    write: StatusWrite,
    event: NewApplicationEvent,
    sideEffects?: (session: ClientSession) => Promise<void>,
  ): Promise<boolean> {
    const ids = ownedIds(applicationId, userId);
    if (ids === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const unset = {
        ...(write.stageLabel === undefined ? { stageLabel: '' } : {}),
        ...(write.appliedAt === undefined ? { appliedAt: '' } : {}),
      };
      const result = await this.applications
        .updateOne(
          { ...ids, version: write.expectedVersion },
          {
            $set: {
              status: write.status,
              ...(write.stageLabel === undefined
                ? {}
                : { stageLabel: write.stageLabel }),
              ...(write.appliedAt === undefined
                ? {}
                : { appliedAt: write.appliedAt }),
              statusChangedAt: write.statusChangedAt,
              updatedAt: write.updatedAt,
            },
            $inc: { version: 1 },
            ...(Object.keys(unset).length === 0 ? {} : { $unset: unset }),
          },
        )
        .session(session)
        .exec();
      if (result.modifiedCount !== 1) {
        return false;
      }
      await this.insertEvent(ids._id, ids.userId, event, session);
      if (sideEffects !== undefined) {
        await sideEffects(session);
      }
      return true;
    });
  }

  async update(
    applicationId: string,
    userId: string,
    write: EditWrite,
  ): Promise<Application | null> {
    const ids = ownedIds(applicationId, userId);
    if (ids === null) {
      return null;
    }
    // Última escritura gana: sin condición de versión, sin `$inc` y sin tocar `statusChangedAt` (D5).
    const updated = await this.applications
      .findOneAndUpdate(
        ids,
        {
          $set: {
            ...(write.notes === undefined ? {} : { notes: write.notes }),
            ...(write.visibility === undefined
              ? {}
              : { visibility: write.visibility }),
            updatedAt: write.updatedAt,
          },
        },
        { returnDocument: 'after' },
      )
      .lean()
      .exec();
    return updated === null ? null : toApplication(updated);
  }

  async delete(applicationId: string, userId: string): Promise<boolean> {
    const ids = ownedIds(applicationId, userId);
    if (ids === null) {
      return false;
    }
    return await this.withTransaction(async (session) => {
      const deleted = await this.applications
        .deleteOne(ids)
        .session(session)
        .exec();
      if (deleted.deletedCount !== 1) {
        return false;
      }
      await this.events
        .deleteMany({ applicationId: ids._id })
        .session(session)
        .exec();
      return true;
    });
  }

  async listByUser(
    userId: string,
    linkIds?: readonly string[],
  ): Promise<Application[]> {
    const user = toUserObjectId(userId);
    if (user === null) {
      return [];
    }
    const links =
      linkIds === undefined ? undefined : toObjectIds(linkIds, toLinkObjectId);
    if (links !== undefined && links.length === 0) {
      return [];
    }
    const documents = await this.applications
      .find({
        userId: user,
        ...(links === undefined ? {} : { linkId: { $in: links } }),
      })
      .sort({ updatedAt: -1, _id: -1 })
      .lean()
      .exec();
    return documents.map(toApplication);
  }

  async eventsOf(
    applicationId: string,
    userId: string,
  ): Promise<ApplicationEvent[]> {
    const ids = ownedIds(applicationId, userId);
    if (ids === null) {
      return [];
    }
    const documents = await this.events
      .find({ applicationId: ids._id, userId: ids.userId })
      .sort({ at: 1, _id: 1 })
      .lean()
      .exec();
    return documents.map(toApplicationEvent);
  }

  async sharedOn(
    linkIds: readonly string[],
    memberIds: readonly string[],
  ): Promise<SharedApplication[]> {
    const links = toObjectIds(linkIds, toLinkObjectId);
    const members = toObjectIds(memberIds, toUserObjectId);
    if (links.length === 0 || members.length === 0) {
      return [];
    }
    // Una sola consulta por `{ linkId, visibility, userId }`, con solo lo que el grupo puede ver (D6).
    const documents = await this.applications
      .find(
        {
          linkId: { $in: links },
          visibility: 'group',
          userId: { $in: members },
        },
        { _id: 0, linkId: 1, userId: 1, status: 1, statusChangedAt: 1 },
      )
      .lean<
        Pick<
          ApplicationDocument,
          'linkId' | 'userId' | 'status' | 'statusChangedAt'
        >[]
      >()
      .exec();
    return documents.map((document) => ({
      linkId: document.linkId.toHexString(),
      userId: document.userId.toHexString(),
      status: document.status,
      statusChangedAt: document.statusChangedAt,
    }));
  }

  /**
   * Relectura de la postulación que ganó la carrera del alta. Protegida para que un test de integración simule que otra
   * pestaña la borró justo antes.
   */
  protected async findExisting(
    userId: Types.ObjectId,
    linkId: Types.ObjectId,
  ): Promise<Application | null> {
    const document = await this.applications
      .findOne({ userId, linkId })
      .lean()
      .exec();
    return document ? toApplication(document) : null;
  }

  /**
   * Escribe un evento del historial dentro de la transacción del cambio. Protegida para que un test de integración la
   * haga fallar y compruebe que el cambio se deshace con ella.
   */
  protected async insertEvent(
    applicationId: Types.ObjectId,
    userId: Types.ObjectId,
    event: NewApplicationEvent,
    session: ClientSession,
  ): Promise<void> {
    await this.events.create(
      [
        {
          applicationId,
          userId,
          ...(event.from === undefined ? {} : { from: event.from }),
          to: event.to,
          ...(event.fromStageLabel === undefined
            ? {}
            : { fromStageLabel: event.fromStageLabel }),
          ...(event.stageLabel === undefined
            ? {}
            : { stageLabel: event.stageLabel }),
          at: event.at,
        },
      ],
      { session },
    );
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

/** `null` si alguno de los dos identificadores no tiene el formato esperado. */
function ownedIds(
  applicationId: string,
  userId: string,
): { _id: Types.ObjectId; userId: Types.ObjectId } | null {
  const id = toApplicationObjectId(applicationId);
  const user = toUserObjectId(userId);
  return id === null || user === null ? null : { _id: id, userId: user };
}

function toObjectIds(
  ids: readonly string[],
  convert: (id: string) => Types.ObjectId | null,
): Types.ObjectId[] {
  return [...new Set(ids)]
    .map(convert)
    .filter((id): id is Types.ObjectId => id !== null);
}

function toDocument(
  tracking: StartedTracking,
  userId: Types.ObjectId,
  linkId: Types.ObjectId,
): Omit<ApplicationDocument, '_id'> {
  const { application } = tracking;
  return {
    userId,
    linkId,
    status: application.status,
    ...(application.stageLabel === undefined
      ? {}
      : { stageLabel: application.stageLabel }),
    visibility: application.visibility,
    notes: application.notes,
    ...(application.appliedAt === undefined
      ? {}
      : { appliedAt: application.appliedAt }),
    statusChangedAt: application.statusChangedAt,
    version: application.version,
    createdAt: application.createdAt,
    updatedAt: application.updatedAt,
  };
}

export function toApplication(document: ApplicationDocument): Application {
  return {
    id: document._id.toHexString(),
    userId: document.userId.toHexString(),
    linkId: document.linkId.toHexString(),
    status: document.status,
    ...(document.stageLabel === undefined || document.stageLabel === null
      ? {}
      : { stageLabel: document.stageLabel }),
    visibility: document.visibility,
    notes: document.notes ?? '',
    ...(document.appliedAt === undefined || document.appliedAt === null
      ? {}
      : { appliedAt: document.appliedAt }),
    statusChangedAt: document.statusChangedAt,
    version: document.version,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  };
}

function toApplicationEvent(
  document: ApplicationEventDocument,
): ApplicationEvent {
  return {
    id: document._id.toHexString(),
    applicationId: document.applicationId.toHexString(),
    userId: document.userId.toHexString(),
    ...(document.from === undefined ? {} : { from: document.from }),
    to: document.to,
    ...(document.fromStageLabel === undefined
      ? {}
      : { fromStageLabel: document.fromStageLabel }),
    ...(document.stageLabel === undefined
      ? {}
      : { stageLabel: document.stageLabel }),
    at: document.at,
  };
}
