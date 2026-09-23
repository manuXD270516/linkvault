import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Types, type Connection } from 'mongoose';
import type { NotificationPreferences } from '@linkvault/shared';
import type {
  ApplicationStaleClaims,
  NotifyDeliveryKey,
  NotifyDeliveryLedger,
  NotifyGroupDirectory,
  NotifyLinkTitles,
  NotifyPreferencesReader,
  NotifyPushSubscription,
  NotifyPushSubscriptions,
  NotifyUserDirectory,
  NotifyUserProfile,
  StaleApplicationRow,
} from '../../application/ports/notify.ports';
import { CLOSED_STATUSES } from '@linkvault/shared';

const PREFS = 'notification_preferences';
const PUSH = 'push_subscriptions';
const DELIVERIES = 'notification_deliveries';
const MEMBERSHIPS = 'group_members';
const GROUPS = 'groups';
const GROUP_LINKS = 'group_links';
const USERS = 'users';
const LINKS = 'job_links';
const APPLICATIONS = 'applications';
const STALE_CLAIMS = 'application_stale_claims';

const CLAIM_LEASE_MS = 5 * 60_000;

function oid(id: string): Types.ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new Types.ObjectId(id) : null;
}

@Injectable()
export class MongoNotifyPreferencesReader implements NotifyPreferencesReader {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async findByUserId(userId: string): Promise<NotificationPreferences | null> {
    const id = oid(userId);
    if (id === null) {
      return null;
    }
    const doc = await this.connection.collection(PREFS).findOne({ userId: id });
    if (doc === null) {
      return null;
    }
    return {
      groupNewLink: Boolean(doc['groupNewLink']),
      applicationStatusGroup: Boolean(doc['applicationStatusGroup']),
      applicationStale: Boolean(doc['applicationStale']),
      // Documentos previos al digest: ausencia ≡ default ON.
      groupWeeklyDigest:
        doc['groupWeeklyDigest'] === undefined
          ? true
          : Boolean(doc['groupWeeklyDigest']),
      notifyOwnActions: Boolean(doc['notifyOwnActions']),
      applicationStatusGroupId:
        (doc['applicationStatusGroupId'] as string | null | undefined) ?? null,
    };
  }
}

@Injectable()
export class MongoNotifyGroupDirectory implements NotifyGroupDirectory {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async memberIdsOf(groupId: string): Promise<string[]> {
    const id = oid(groupId);
    if (id === null) {
      return [];
    }
    const docs = await this.connection
      .collection(MEMBERSHIPS)
      .find({ groupId: id }, { projection: { userId: 1 } })
      .toArray();
    return docs.map((d) => String(d['userId']));
  }

  async groupIdsOfLink(linkId: string): Promise<string[]> {
    const id = oid(linkId);
    if (id === null) {
      return [];
    }
    const docs = await this.connection
      .collection(GROUP_LINKS)
      .find({ linkId: id }, { projection: { groupId: 1 } })
      .toArray();
    return docs.map((d) => String(d['groupId']));
  }

  async groupNameOf(groupId: string): Promise<string | null> {
    const id = oid(groupId);
    if (id === null) {
      return null;
    }
    const doc = await this.connection
      .collection(GROUPS)
      .findOne({ _id: id }, { projection: { name: 1 } });
    return doc === null ? null : String(doc['name'] ?? '');
  }
}

@Injectable()
export class MongoNotifyUserDirectory implements NotifyUserDirectory {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async profilesOf(userIds: readonly string[]): Promise<NotifyUserProfile[]> {
    const oids = userIds.map(oid).filter((x): x is Types.ObjectId => x !== null);
    if (oids.length === 0) {
      return [];
    }
    const docs = await this.connection
      .collection(USERS)
      .find({ _id: { $in: oids } })
      .toArray();
    return docs.map((doc) => ({
      userId: String(doc._id),
      email: String(doc['email'] ?? ''),
      displayName: String(doc['displayName'] ?? 'Usuario'),
      emailVerified: doc['emailVerified'] !== false,
      outputLanguage: doc['outputLanguage'] === 'en' ? 'en' : 'es',
    }));
  }
}

@Injectable()
export class MongoNotifyPushSubscriptions implements NotifyPushSubscriptions {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listByUserId(
    userId: string,
  ): Promise<readonly NotifyPushSubscription[]> {
    const id = oid(userId);
    if (id === null) {
      return [];
    }
    const docs = await this.connection
      .collection(PUSH)
      .find({ userId: id })
      .toArray();
    return docs.map((doc) => ({
      userId,
      endpoint: String(doc['endpoint']),
      p256dh: String(doc['p256dh']),
      auth: String(doc['auth']),
    }));
  }

  async deleteEndpoint(endpoint: string): Promise<void> {
    await this.connection.collection(PUSH).deleteMany({ endpoint });
  }
}

@Injectable()
export class MongoNotifyDeliveryLedger implements NotifyDeliveryLedger {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async claim(
    key: NotifyDeliveryKey,
    now: Date,
  ): Promise<'claimed' | 'already_done' | 'in_flight'> {
    const userId = oid(key.userId);
    if (userId === null) {
      throw new Error('bad userId');
    }
    const filter = {
      type: key.type,
      aggregateKey: key.aggregateKey,
      userId,
      channel: key.channel,
    };
    const existing = await this.connection
      .collection(DELIVERIES)
      .findOne(filter);
    if (existing !== null) {
      if (
        existing['status'] === 'completed' ||
        existing['status'] === 'failed'
      ) {
        return 'already_done';
      }
      const claimedAt = existing['claimedAt'] as Date;
      if (
        existing['status'] === 'claimed' &&
        now.getTime() - claimedAt.getTime() < CLAIM_LEASE_MS
      ) {
        return 'in_flight';
      }
      await this.connection.collection(DELIVERIES).updateOne(filter, {
        $set: { status: 'claimed', claimedAt: now, updatedAt: now },
      });
      return 'claimed';
    }
    try {
      await this.connection.collection(DELIVERIES).insertOne({
        ...filter,
        status: 'claimed',
        claimedAt: now,
        updatedAt: now,
      });
      return 'claimed';
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: number }).code === 11000
      ) {
        return this.claim(key, now);
      }
      throw error;
    }
  }

  async markCompleted(key: NotifyDeliveryKey, now: Date): Promise<void> {
    await this.setStatus(key, 'completed', now);
  }

  async markFailed(key: NotifyDeliveryKey, now: Date): Promise<void> {
    await this.setStatus(key, 'failed', now);
  }

  private async setStatus(
    key: NotifyDeliveryKey,
    status: string,
    now: Date,
  ): Promise<void> {
    const userId = oid(key.userId);
    if (userId === null) {
      return;
    }
    await this.connection.collection(DELIVERIES).updateOne(
      {
        type: key.type,
        aggregateKey: key.aggregateKey,
        userId,
        channel: key.channel,
      },
      { $set: { status, updatedAt: now } },
    );
  }
}

@Injectable()
export class MongoNotifyLinkTitles implements NotifyLinkTitles {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async titleOf(linkId: string): Promise<string | null> {
    const id = oid(linkId);
    if (id === null) {
      return null;
    }
    const doc = await this.connection
      .collection(LINKS)
      .findOne({ _id: id }, { projection: { 'preview.title': 1 } });
    const title = doc?.['preview']?.['title'];
    return typeof title === 'string' ? title : null;
  }
}

@Injectable()
export class MongoApplicationStaleClaims implements ApplicationStaleClaims {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listEligible(
    threshold: Date,
    limit: number,
  ): Promise<StaleApplicationRow[]> {
    const docs = await this.connection
      .collection(APPLICATIONS)
      .find({
        status: { $nin: [...CLOSED_STATUSES] },
        statusChangedAt: { $lte: threshold },
      })
      .limit(limit)
      .toArray();
    const rows: StaleApplicationRow[] = [];
    for (const doc of docs) {
      const statusChangedAt = doc['statusChangedAt'] as Date;
      const applicationId = String(doc._id);
      const claim = await this.connection.collection(STALE_CLAIMS).findOne({
        applicationId,
        statusChangedAt,
        confirmed: true,
      });
      if (claim !== null) {
        continue;
      }
      rows.push({
        applicationId,
        userId: String(doc['userId']),
        linkId: String(doc['linkId']),
        status: String(doc['status']),
        statusChangedAt,
      });
    }
    return rows;
  }

  async claim(
    applicationId: string,
    statusChangedAt: Date,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const existing = await this.connection.collection(STALE_CLAIMS).findOne({
      applicationId,
      statusChangedAt,
    });
    if (existing !== null) {
      if (existing['confirmed'] === true) {
        return false;
      }
      const claimedAt = existing['claimedAt'] as Date;
      if (now.getTime() - claimedAt.getTime() < leaseMs) {
        return false;
      }
    }
    await this.connection.collection(STALE_CLAIMS).updateOne(
      { applicationId, statusChangedAt },
      {
        $set: {
          applicationId,
          statusChangedAt,
          claimedAt: now,
          confirmed: false,
        },
      },
      { upsert: true },
    );
    return true;
  }

  async release(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<void> {
    await this.connection.collection(STALE_CLAIMS).deleteOne({
      applicationId,
      statusChangedAt,
      confirmed: false,
    });
  }

  async confirm(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<void> {
    await this.connection.collection(STALE_CLAIMS).updateOne(
      { applicationId, statusChangedAt },
      { $set: { confirmed: true } },
    );
  }
}
