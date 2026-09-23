import {
  OPEN_STATUSES_FOR_VACANCY_EXPIRE,
  type ClosedReason,
  type Platform,
  type PreviewStatus,
  type StoredPreview,
} from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import {
  Types,
  type ClientSession,
  type Connection,
} from 'mongoose';
import type {
  ClosedLinkApplicationRow,
  ClosedLinkApplications,
  FreshnessLinkClaims,
  FreshnessLinkRow,
  FreshnessLinkStore,
  StatusGroupNotifyClaims,
} from '../../application/ports/freshness.ports';
import { isExpiresAtPast } from '../../domain/freshness-policy';

const LINKS = 'job_links';
const APPLICATIONS = 'applications';
const EVENTS = 'application_events';
const FRESHNESS_CLAIMS = 'link_freshness_claims';
const ASN_CLAIMS = 'application_status_group_notify_claims';

const USABLE_PREVIEW = ['enriched', 'partial', 'manual'] as const;

@Injectable()
export class MongoFreshnessLinkStore implements FreshnessLinkStore {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listOpenEligible(input: {
    readonly now: Date;
    readonly intervalDays: number;
    readonly limit: number;
  }): Promise<FreshnessLinkRow[]> {
    const cadenceBefore = new Date(
      input.now.getTime() - input.intervalDays * 24 * 60 * 60 * 1000,
    );
    const today = input.now.toISOString().slice(0, 10);
    const docs = await this.connection
      .collection(LINKS)
      .find({
        closedAt: { $exists: false },
        previewStatus: { $in: [...USABLE_PREVIEW] },
        $or: [
          {
            $expr: {
              $lte: [
                { $ifNull: ['$lastFreshnessCheckAt', '$previewRequestedAt'] },
                cadenceBefore,
              ],
            },
          },
          {
            'preview.expiresAt': { $exists: true, $lt: today },
          },
        ],
      })
      .limit(input.limit * 3)
      .toArray();

    const rows: FreshnessLinkRow[] = [];
    for (const doc of docs) {
      const row = toRow(doc);
      if (row === null) continue;
      const last =
        row.lastFreshnessCheckAt ?? row.previewRequestedAt ?? row.updatedAt;
      const cadenceDue = last.getTime() <= cadenceBefore.getTime();
      const expires =
        typeof row.preview.expiresAt === 'string' &&
        isExpiresAtPast(row.preview.expiresAt, input.now);
      if (!cadenceDue && !expires) continue;
      rows.push(row);
      if (rows.length >= input.limit) break;
    }
    return rows;
  }

  async listCascadePending(input: {
    readonly limit: number;
  }): Promise<FreshnessLinkRow[]> {
    const openStatuses = [...OPEN_STATUSES_FOR_VACANCY_EXPIRE];
    const closedWithOpen = await this.connection
      .collection(APPLICATIONS)
      .aggregate<{ _id: Types.ObjectId }>([
        {
          $match: {
            $or: [
              { status: { $in: openStatuses } },
              { status: 'expired', visibility: 'group' },
            ],
          },
        },
        { $group: { _id: '$linkId' } },
        { $limit: input.limit * 4 },
      ])
      .toArray();

    const linkIds = closedWithOpen.map((r) => r._id);
    if (linkIds.length === 0) return [];

    const docs = await this.connection
      .collection(LINKS)
      .find({
        _id: { $in: linkIds },
        closedAt: { $exists: true },
      })
      .limit(input.limit * 2)
      .toArray();

    const rows: FreshnessLinkRow[] = [];
    for (const doc of docs) {
      const row = toRow(doc);
      if (row === null || row.closedAt === undefined) continue;
      const apps = await this.connection
        .collection(APPLICATIONS)
        .find({ linkId: doc._id })
        .toArray();
      let pending = false;
      for (const app of apps) {
        if (openStatuses.includes(String(app['status']) as never)) {
          pending = true;
          break;
        }
        if (
          app['status'] === 'expired' &&
          app['visibility'] === 'group'
        ) {
          const confirmed = await this.connection.collection(ASN_CLAIMS).findOne({
            applicationId: String(app._id),
            statusChangedAt: app['statusChangedAt'],
            confirmed: true,
          });
          if (confirmed === null) {
            pending = true;
            break;
          }
        }
      }
      if (!pending) continue;
      rows.push(row);
      if (rows.length >= input.limit) break;
    }
    return rows;
  }

  async findById(linkId: string): Promise<FreshnessLinkRow | null> {
    const id = toObjectId(linkId);
    if (id === null) return null;
    const doc = await this.connection.collection(LINKS).findOne({ _id: id });
    return doc === null ? null : toRow(doc);
  }

  async closeIfOpen(
    linkId: string,
    write: {
      readonly closedAt: Date;
      readonly closedReason: ClosedReason;
      readonly lastFreshnessCheckAt: Date;
    },
  ): Promise<boolean> {
    const id = toObjectId(linkId);
    if (id === null) return false;
    const result = await this.connection.collection(LINKS).updateOne(
      { _id: id, closedAt: { $exists: false } },
      {
        $set: {
          closedAt: write.closedAt,
          closedReason: write.closedReason,
          lastFreshnessCheckAt: write.lastFreshnessCheckAt,
          updatedAt: write.closedAt,
        },
      },
    );
    if (result.modifiedCount === 1) return true;
    await this.connection.collection(LINKS).updateOne(
      { _id: id, closedAt: { $exists: true } },
      { $set: { lastFreshnessCheckAt: write.lastFreshnessCheckAt } },
    );
    return false;
  }

  async touchFreshnessCheck(linkId: string, at: Date): Promise<void> {
    const id = toObjectId(linkId);
    if (id === null) return;
    await this.connection
      .collection(LINKS)
      .updateOne(
        { _id: id },
        { $set: { lastFreshnessCheckAt: at, updatedAt: at } },
      );
  }
}

@Injectable()
export class MongoFreshnessLinkClaims implements FreshnessLinkClaims {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async claim(linkId: string, now: Date, leaseMs: number): Promise<boolean> {
    const existing = await this.connection
      .collection(FRESHNESS_CLAIMS)
      .findOne({ linkId });
    if (existing !== null) {
      if (existing['confirmed'] === true) {
        // Confirmed claims are for the current processing window; allow reclaim after lease
        // by treating confirmed as soft until we use a generation. For V0: confirmed blocks
        // only while lease would still be active from claimedAt — actually design says lease
        // if enqueue fails. After confirm, next tick should be able to claim cascade again.
        // So confirmed should NOT permanently block — only live unconfirmed leases do.
        // Re-read: stale confirms permanently until statusChangedAt changes.
        // For freshness links, confirm means "this tick finished". Next tick must reclaim.
        // Delete on confirm after short TTL, or don't use confirmed as hard block.
        // Spec: "si el encolado falla, la marca NO SHALL quedar dura" — after success,
        // next eligibility is by selectors, not claim. So confirm can delete the claim.
      }
      if (existing['confirmed'] !== true) {
        const claimedAt = existing['claimedAt'] as Date;
        if (now.getTime() - claimedAt.getTime() < leaseMs) {
          return false;
        }
      }
    }
    await this.connection.collection(FRESHNESS_CLAIMS).updateOne(
      { linkId },
      {
        $set: {
          linkId,
          claimedAt: now,
          confirmed: false,
        },
      },
      { upsert: true },
    );
    return true;
  }

  async release(linkId: string): Promise<void> {
    await this.connection.collection(FRESHNESS_CLAIMS).deleteOne({
      linkId,
      confirmed: false,
    });
  }

  async confirm(linkId: string): Promise<void> {
    // Tras éxito, liberamos la marca dura para que el siguiente tick pueda reclamar cascada.
    await this.connection.collection(FRESHNESS_CLAIMS).deleteOne({ linkId });
  }
}

@Injectable()
export class MongoClosedLinkApplications implements ClosedLinkApplications {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async listForExpireCascade(
    linkId: string,
  ): Promise<ClosedLinkApplicationRow[]> {
    const id = toObjectId(linkId);
    if (id === null) return [];
    const docs = await this.connection
      .collection(APPLICATIONS)
      .find({
        linkId: id,
        $or: [
          { status: { $in: [...OPEN_STATUSES_FOR_VACANCY_EXPIRE] } },
          { status: 'expired', visibility: 'group' },
        ],
      })
      .toArray();

    const rows: ClosedLinkApplicationRow[] = [];
    for (const doc of docs) {
      const row = toAppRow(doc);
      if (row === null) continue;
      if (row.status === 'expired' && row.visibility === 'group') {
        const confirmed = await this.connection.collection(ASN_CLAIMS).findOne({
          applicationId: row.applicationId,
          statusChangedAt: row.statusChangedAt,
          confirmed: true,
        });
        if (confirmed !== null) continue;
      }
      rows.push(row);
    }
    return rows;
  }

  async expireIfOpen(
    applicationId: string,
    now: Date,
  ): Promise<ClosedLinkApplicationRow | null> {
    const id = toObjectId(applicationId);
    if (id === null) return null;

    return await this.withTransaction(async (session) => {
      const current = await this.connection
        .collection(APPLICATIONS)
        .findOne({ _id: id }, { session });
      if (current === null) return null;
      const from = String(current['status']);
      if (
        !(OPEN_STATUSES_FOR_VACANCY_EXPIRE as readonly string[]).includes(from)
      ) {
        return null;
      }
      const version = Number(current['version']);
      const result = await this.connection.collection(APPLICATIONS).updateOne(
        {
          _id: id,
          status: { $in: [...OPEN_STATUSES_FOR_VACANCY_EXPIRE] },
          version,
        },
        {
          $set: {
            status: 'expired',
            statusChangedAt: now,
            updatedAt: now,
          },
          $inc: { version: 1 },
          $unset: { stageLabel: '' },
        },
        { session },
      );
      if (result.modifiedCount !== 1) return null;

      await this.insertExpireEvent(
        {
          applicationId: id,
          userId: current['userId'] as Types.ObjectId,
          from,
          ...(typeof current['stageLabel'] === 'string'
            ? { fromStageLabel: current['stageLabel'] }
            : {}),
          at: now,
        },
        session,
      );

      const updated = await this.connection
        .collection(APPLICATIONS)
        .findOne({ _id: id }, { session });
      return updated === null ? null : toAppRow(updated);
    });
  }

  /**
   * Sobreescribible en tests para demostrar que status+evento van en la misma transacción
   * (mismo patrón que `MongoApplicationRepository.insertEvent`).
   */
  protected async insertExpireEvent(
    event: {
      readonly applicationId: Types.ObjectId;
      readonly userId: Types.ObjectId;
      readonly from: string;
      readonly fromStageLabel?: string;
      readonly at: Date;
    },
    session: ClientSession,
  ): Promise<void> {
    await this.connection.collection(EVENTS).insertOne(
      {
        applicationId: event.applicationId,
        userId: event.userId,
        from: event.from,
        to: 'expired',
        ...(event.fromStageLabel === undefined
          ? {}
          : { fromStageLabel: event.fromStageLabel }),
        at: event.at,
      },
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

@Injectable()
export class MongoStatusGroupNotifyClaims implements StatusGroupNotifyClaims {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async claim(
    applicationId: string,
    statusChangedAt: Date,
    now: Date,
    leaseMs: number,
  ): Promise<boolean> {
    const existing = await this.connection.collection(ASN_CLAIMS).findOne({
      applicationId,
      statusChangedAt,
    });
    if (existing !== null) {
      if (existing['confirmed'] === true) return false;
      const claimedAt = existing['claimedAt'] as Date;
      if (now.getTime() - claimedAt.getTime() < leaseMs) return false;
    }
    await this.connection.collection(ASN_CLAIMS).updateOne(
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
    await this.connection.collection(ASN_CLAIMS).deleteOne({
      applicationId,
      statusChangedAt,
      confirmed: false,
    });
  }

  async confirm(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<void> {
    await this.connection.collection(ASN_CLAIMS).updateOne(
      { applicationId, statusChangedAt },
      { $set: { confirmed: true } },
    );
  }

  async isConfirmed(
    applicationId: string,
    statusChangedAt: Date,
  ): Promise<boolean> {
    const doc = await this.connection.collection(ASN_CLAIMS).findOne({
      applicationId,
      statusChangedAt,
      confirmed: true,
    });
    return doc !== null;
  }
}

function toObjectId(id: string): Types.ObjectId | null {
  if (!Types.ObjectId.isValid(id) || id.length !== 24) return null;
  return new Types.ObjectId(id);
}

function toRow(doc: Record<string, unknown>): FreshnessLinkRow | null {
  const id = doc['_id'];
  if (!(id instanceof Types.ObjectId)) return null;
  return {
    linkId: id.toHexString(),
    previewStatus: doc['previewStatus'] as PreviewStatus,
    previewVersion: Number(doc['previewVersion']),
    preview: (doc['preview'] ?? {}) as StoredPreview,
    platform: (doc['platform'] ?? 'generic') as Platform,
    displayUrl: String(doc['displayUrl'] ?? ''),
    ...(doc['closedAt'] instanceof Date ? { closedAt: doc['closedAt'] } : {}),
    ...(typeof doc['closedReason'] === 'string'
      ? { closedReason: doc['closedReason'] as ClosedReason }
      : {}),
    ...(doc['lastFreshnessCheckAt'] instanceof Date
      ? { lastFreshnessCheckAt: doc['lastFreshnessCheckAt'] }
      : {}),
    ...(doc['previewRequestedAt'] instanceof Date
      ? { previewRequestedAt: doc['previewRequestedAt'] }
      : {}),
    updatedAt:
      doc['updatedAt'] instanceof Date ? doc['updatedAt'] : new Date(0),
  };
}

function toAppRow(
  doc: Record<string, unknown>,
): ClosedLinkApplicationRow | null {
  const id = doc['_id'];
  if (!(id instanceof Types.ObjectId)) return null;
  const linkId = doc['linkId'];
  const userId = doc['userId'];
  if (!(linkId instanceof Types.ObjectId) || !(userId instanceof Types.ObjectId)) {
    return null;
  }
  return {
    applicationId: id.toHexString(),
    userId: userId.toHexString(),
    linkId: linkId.toHexString(),
    status: String(doc['status']),
    visibility: doc['visibility'] === 'group' ? 'group' : 'private',
    statusChangedAt:
      doc['statusChangedAt'] instanceof Date
        ? doc['statusChangedAt']
        : new Date(0),
    version: Number(doc['version'] ?? 1),
    ...(typeof doc['stageLabel'] === 'string'
      ? { stageLabel: doc['stageLabel'] }
      : {}),
  };
}
