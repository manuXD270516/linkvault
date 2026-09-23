import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection, type Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoClosedLinkApplications } from './mongo-freshness.adapters';

const APPLICATIONS = 'applications';
const EVENTS = 'application_events';

let connection: Connection;
let apps: MongoClosedLinkApplications;

const NOW = new Date('2026-09-22T12:00:00.000Z');
const oid = (): mongoose.Types.ObjectId => new mongoose.Types.ObjectId();

/** Falla al escribir el evento: status y evento deben revertirse juntos. */
class FailingExpireEvents extends MongoClosedLinkApplications {
  protected override insertExpireEvent(): Promise<void> {
    return Promise.reject(new Error('event insert failed'));
  }
}

async function insertOpenApplication(overrides: {
  readonly status?: string;
  readonly version?: number;
  readonly stageLabel?: string;
} = {}): Promise<{
  readonly applicationId: string;
  readonly userId: Types.ObjectId;
  readonly linkId: Types.ObjectId;
}> {
  const _id = oid();
  const userId = oid();
  const linkId = oid();
  await connection.collection(APPLICATIONS).insertOne({
    _id,
    userId,
    linkId,
    status: overrides.status ?? 'applied',
    visibility: 'private',
    version: overrides.version ?? 3,
    statusChangedAt: new Date('2026-09-20T10:00:00.000Z'),
    updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    ...(overrides.stageLabel === undefined
      ? {}
      : { stageLabel: overrides.stageLabel }),
  });
  return {
    applicationId: _id.toHexString(),
    userId,
    linkId,
  };
}

function eventCount(applicationId: string): Promise<number> {
  return connection.collection(EVENTS).countDocuments({
    applicationId: new mongoose.Types.ObjectId(applicationId),
  });
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `freshness-expire-${randomUUID()}`,
    })
    .asPromise();
  apps = new MongoClosedLinkApplications(connection);
});

afterEach(async () => {
  await connection.collection(APPLICATIONS).deleteMany({});
  await connection.collection(EVENTS).deleteMany({});
});

afterAll(async () => {
  await connection.close();
});

describe('MongoClosedLinkApplications.expireIfOpen', () => {
  it('expires an open application and writes exactly one history event', async () => {
    const { applicationId } = await insertOpenApplication({
      status: 'applied',
      version: 3,
      stageLabel: 'Tech screen',
    });

    const row = await apps.expireIfOpen(applicationId, NOW);

    expect(row).toMatchObject({
      applicationId,
      status: 'expired',
      version: 4,
      statusChangedAt: NOW,
    });
    expect(row?.stageLabel).toBeUndefined();

    const doc = await connection.collection(APPLICATIONS).findOne({
      _id: new mongoose.Types.ObjectId(applicationId),
    });
    expect(doc).toMatchObject({
      status: 'expired',
      version: 4,
      statusChangedAt: NOW,
    });
    expect(doc?.['stageLabel']).toBeUndefined();

    expect(await eventCount(applicationId)).toBe(1);
    const event = await connection.collection(EVENTS).findOne({
      applicationId: new mongoose.Types.ObjectId(applicationId),
    });
    expect(event).toMatchObject({
      from: 'applied',
      to: 'expired',
      fromStageLabel: 'Tech screen',
      at: NOW,
    });
  });

  it('is idempotent: a second expire writes no extra event', async () => {
    const { applicationId } = await insertOpenApplication({ status: 'offer' });

    const first = await apps.expireIfOpen(applicationId, NOW);
    expect(first?.status).toBe('expired');
    expect(await eventCount(applicationId)).toBe(1);

    const second = await apps.expireIfOpen(
      applicationId,
      new Date('2026-09-22T13:00:00.000Z'),
    );
    expect(second).toBeNull();
    expect(await eventCount(applicationId)).toBe(1);

    const doc = await connection.collection(APPLICATIONS).findOne({
      _id: new mongoose.Types.ObjectId(applicationId),
    });
    expect(doc).toMatchObject({ status: 'expired', version: 4 });
  });

  it('rolls back status when the history event insert fails', async () => {
    const failing = new FailingExpireEvents(connection);
    const { applicationId } = await insertOpenApplication({
      status: 'interested',
      version: 1,
    });

    await expect(failing.expireIfOpen(applicationId, NOW)).rejects.toThrow(
      'event insert failed',
    );

    const doc = await connection.collection(APPLICATIONS).findOne({
      _id: new mongoose.Types.ObjectId(applicationId),
    });
    expect(doc).toMatchObject({
      status: 'interested',
      version: 1,
    });
    expect(await eventCount(applicationId)).toBe(0);

    const recovered = await apps.expireIfOpen(applicationId, NOW);
    expect(recovered).toMatchObject({ status: 'expired', version: 2 });
    expect(await eventCount(applicationId)).toBe(1);
  });

  it('leaves rejected and accepted untouched', async () => {
    const rejected = await insertOpenApplication({ status: 'rejected' });
    const accepted = await insertOpenApplication({ status: 'accepted' });

    expect(await apps.expireIfOpen(rejected.applicationId, NOW)).toBeNull();
    expect(await apps.expireIfOpen(accepted.applicationId, NOW)).toBeNull();
    expect(await eventCount(rejected.applicationId)).toBe(0);
    expect(await eventCount(accepted.applicationId)).toBe(0);
  });
});
