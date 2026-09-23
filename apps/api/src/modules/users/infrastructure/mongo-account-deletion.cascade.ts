import {
  USER_AI_KEYS_REPOSITORY,
  type UserAiKeysRepository,
} from '@linkvault/ai';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type ClientSession,
  type Connection,
} from 'mongoose';
import { GroupsFacade } from '../../groups/application/groups.facade';
import { SearchFacade } from '../../search/application/search.facade';
import { SoleOwnerWithMembers } from '../domain/errors';
import type { AccountDeletionCascade } from '../application/ports/account-deletion-cascade.port';
import {
  CV_USER_PREFIX_DELETER,
  type CvUserPrefixDeleter,
} from '../application/ports/cv-user-prefix-deleter.port';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../application/ports/user-repository.port';

// Cascada de borrado de cuenta (D4/D11, ADR-033 + search D9): purge Meili **antes** del commit Mongo
// cuando FEATURE_SEARCH=true; si Meili falla → SearchPurgeFailed y cuenta intacta.

const AUTH_SESSIONS_COLLECTION = 'auth_sessions';
const REFRESH_TOKENS_COLLECTION = 'refresh_tokens';
const AUTH_EMAIL_TOKENS_COLLECTION = 'auth_email_tokens';
const NOTIFICATION_PREFERENCES_COLLECTION = 'notification_preferences';
const PUSH_SUBSCRIPTIONS_COLLECTION = 'push_subscriptions';
const NOTIFICATION_DELIVERIES_COLLECTION = 'notification_deliveries';
const GROUP_LINK_COMMENTS_COLLECTION = 'group_link_comments';
const GROUP_LINKS_COLLECTION = 'group_links';
const USER_LINKS_COLLECTION = 'user_links';
const APPLICATIONS_COLLECTION = 'applications';
const APPLICATION_EVENTS_COLLECTION = 'application_events';
const CV_DOCUMENTS_COLLECTION = 'cv_documents';
const CV_VERSION_COUNTERS_COLLECTION = 'cv_version_counters';
const AI_ANALYSES_COLLECTION = 'ai_analyses';
const ROADMAPS_COLLECTION = 'roadmaps';
const AI_FEEDBACK_COLLECTION = 'ai_feedback';
const AI_USAGE_COLLECTION = 'ai_usage';

@Injectable()
export class MongoAccountDeletionCascade implements AccountDeletionCascade {
  private readonly logger = new Logger(MongoAccountDeletionCascade.name);

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
    // Explicit tokens: Nest CLIs must resolve these without relying solely on
    // design:paramtypes (see apps/api/register-nest-cli.cjs).
    @Inject(GroupsFacade) private readonly groups: GroupsFacade,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(USER_AI_KEYS_REPOSITORY)
    private readonly keys: UserAiKeysRepository,
    @Inject(CV_USER_PREFIX_DELETER)
    private readonly cvFiles: CvUserPrefixDeleter,
    @Inject(SearchFacade) private readonly search: SearchFacade,
  ) {}

  async execute(userId: string): Promise<void> {
    if (await this.groups.ownershipBlocksAccountDeletion(userId)) {
      throw new SoleOwnerWithMembers();
    }

    // D9: grupos que la cascada va a borrar (owner único = todos los owned tras el bloqueo).
    const ownedGroupIds = (await this.groups.getGroupsOf(userId))
      .filter((m) => m.role === 'owner')
      .map((m) => m.groupId);
    await this.search.purgeUser(userId, ownedGroupIds);

    const session = await this.connection.startSession();
    try {
      await session.withTransaction(async () => {
        await this.groups.detachUserInSession(userId, session);
        await this.deletePersonalData(userId, session);
        const deleted = await this.users.delete(userId, session);
        if (!deleted) {
          throw new Error(
            `User "${userId}" disappeared during account deletion`,
          );
        }
      });
    } finally {
      await session.endSession();
    }

    try {
      await this.cvFiles.deleteAllForUser(userId);
    } catch (error: unknown) {
      this.logger.warn(
        `CV prefix cleanup after account deletion failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  private async deletePersonalData(
    userId: string,
    session: ClientSession,
  ): Promise<void> {
    const userOid = toObjectId(userId);
    if (userOid === null) {
      throw new Error(`Malformed user id in account deletion`);
    }

    await this.connection
      .collection(AUTH_SESSIONS_COLLECTION)
      .deleteMany({ userId }, { session });
    await this.connection
      .collection(REFRESH_TOKENS_COLLECTION)
      .deleteMany({ userId }, { session });
    await this.connection
      .collection(AUTH_EMAIL_TOKENS_COLLECTION)
      .deleteMany({ userId }, { session });

    await this.connection
      .collection(NOTIFICATION_PREFERENCES_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    await this.connection
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    await this.connection
      .collection(NOTIFICATION_DELIVERIES_COLLECTION)
      .deleteMany({ userId: userOid }, { session });

    await this.deleteCommentsAndUpdateCounts(userOid, session);

    await this.connection.collection(GROUP_LINKS_COLLECTION).updateMany(
      { sharedBy: userOid },
      { $unset: { note: 1 } },
      { session },
    );
    await this.connection.collection(GROUP_LINKS_COLLECTION).updateMany(
      { 'publicShare.publishedBy': userOid },
      { $unset: { publicShare: 1 } },
      { session },
    );
    // Flag know-someone (D4 de know-someone-flag): quita el userId de todos los arrays donde figure.
    await this.connection.collection(GROUP_LINKS_COLLECTION).updateMany(
      { knowSomeoneUserIds: userOid },
      // Cast: mongoose tipa `$pull` sobre Document genérico de forma demasiado estrecha para ObjectId.
      { $pull: { knowSomeoneUserIds: userOid } } as Record<string, unknown>,
      { session },
    );

    await this.connection
      .collection(USER_LINKS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });

    const applicationIds = (
      await this.connection
        .collection(APPLICATIONS_COLLECTION)
        .find({ userId: userOid }, { projection: { _id: 1 }, session })
        .toArray()
    ).map((doc) => doc._id);
    if (applicationIds.length > 0) {
      await this.connection
        .collection(APPLICATION_EVENTS_COLLECTION)
        .deleteMany({ applicationId: { $in: applicationIds } }, { session });
    }
    await this.connection
      .collection(APPLICATIONS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    await this.connection
      .collection(APPLICATION_EVENTS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });

    await this.connection
      .collection(CV_DOCUMENTS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    // Contador de versiones: `_id` es el userId en hex (string), no ObjectId.
    await this.connection
      .collection(CV_VERSION_COUNTERS_COLLECTION)
      .deleteOne({ _id: userId } as never, { session });

    await this.connection
      .collection(AI_ANALYSES_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    await this.connection
      .collection(ROADMAPS_COLLECTION)
      .deleteMany({ userId: userOid }, { session });
    await this.connection
      .collection(AI_FEEDBACK_COLLECTION)
      .deleteMany({ userId: userOid }, { session });

    await this.connection
      .collection(AI_USAGE_COLLECTION)
      .deleteMany({ userId }, { session });

    await this.keys.deleteAllKeysForUser(userId, session);
  }

  private async deleteCommentsAndUpdateCounts(
    authorId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const pairs = await this.connection
      .collection(GROUP_LINK_COMMENTS_COLLECTION)
      .aggregate<{
        _id: { groupId: Types.ObjectId; linkId: Types.ObjectId };
        n: number;
      }>(
        [
          { $match: { authorId } },
          {
            $group: {
              _id: { groupId: '$groupId', linkId: '$linkId' },
              n: { $sum: 1 },
            },
          },
        ],
        { session },
      )
      .toArray();

    for (const pair of pairs) {
      const deleted = await this.connection
        .collection(GROUP_LINK_COMMENTS_COLLECTION)
        .deleteMany(
          {
            groupId: pair._id.groupId,
            linkId: pair._id.linkId,
            authorId,
          },
          { session },
        );
      if (deleted.deletedCount > 0) {
        await this.connection.collection(GROUP_LINKS_COLLECTION).updateOne(
          { groupId: pair._id.groupId, linkId: pair._id.linkId },
          {
            $inc: {
              commentCount: -deleted.deletedCount,
              commentsRevision: 1,
            },
          },
          { session },
        );
      }
    }
  }
}

function toObjectId(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}
