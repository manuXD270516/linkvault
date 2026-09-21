import { ROADMAP_REQUESTED_EVENT_TYPE } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type ClientSession, type Connection } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  OUTBOX_EVENT_MODEL_NAME,
  outboxEventSchema,
  type OutboxEventDocument,
} from '../../../infrastructure/outbox/outbox-event.schemas';
import type {
  Outbox,
  OutboxEvent,
} from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import { MongoRoadmapRepository } from './mongo-roadmap.repository';
import {
  ROADMAP_MODEL_NAME,
  roadmapSchema,
} from './roadmap.schemas';

let connection: Connection;
let repository: MongoRoadmapRepository;
let outbox: RecordingOutbox;

const NOW = new Date('2026-09-21T12:00:00.000Z');
const ANA = new mongoose.Types.ObjectId().toHexString();
const ANALYSIS = new mongoose.Types.ObjectId().toHexString();

class RecordingOutbox implements Outbox {
  readonly appended: OutboxEvent[] = [];

  constructor(private readonly events: Connection) {}

  async append(event: OutboxEvent, session: TransactionSession): Promise<void> {
    this.appended.push(event);
    await this.events
      .model<OutboxEventDocument>(OUTBOX_EVENT_MODEL_NAME)
      .create(
        [
          {
            type: event.type,
            payload: event.payload,
            createdAt: NOW,
            publishedAt: null,
            failedAt: null,
            attempts: 0,
            nextAttemptAt: NOW,
          },
        ],
        { session: session as ClientSession },
      );
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(await getMongoTestUri(), { bufferCommands: false })
    .asPromise();
  const roadmaps = connection.model(ROADMAP_MODEL_NAME, roadmapSchema);
  connection.model(OUTBOX_EVENT_MODEL_NAME, outboxEventSchema);
  await roadmaps.createIndexes();
});

afterAll(async () => {
  await connection.close();
});

beforeEach(() => {
  outbox = new RecordingOutbox(connection);
  repository = new MongoRoadmapRepository(connection, outbox);
});

afterEach(async () => {
  await connection.model(ROADMAP_MODEL_NAME).deleteMany({});
  await connection.model(OUTBOX_EVENT_MODEL_NAME).deleteMany({});
  outbox.appended.length = 0;
});

describe('MongoRoadmapRepository claim race', () => {
  it('solo un claim gana el insert único por analysisId', async () => {
    const idA = new mongoose.Types.ObjectId().toHexString();
    const idB = new mongoose.Types.ObjectId().toHexString();

    const [first, second] = await Promise.all([
      repository.claimGenerating({
        id: idA,
        analysisId: ANALYSIS,
        userId: ANA,
        createdAt: NOW,
      }),
      repository.claimGenerating({
        id: idB,
        analysisId: ANALYSIS,
        userId: ANA,
        createdAt: NOW,
      }),
    ]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'exists']);

    const count = await connection
      .model(ROADMAP_MODEL_NAME)
      .countDocuments({ analysisId: new mongoose.Types.ObjectId(ANALYSIS) });
    expect(count).toBe(1);

    const found = await repository.findByAnalysisId(ANALYSIS);
    expect(found).not.toBeNull();
    expect(found?.status).toBe('generating');

    // Al menos un outbox del ganador (reintentos de tx pueden duplicar appends en carrera).
    expect(
      outbox.appended.some((e) => e.type === ROADMAP_REQUESTED_EVENT_TYPE),
    ).toBe(true);
  });

  it('el segundo claim secuencial no escribe otro outbox', async () => {
    const claimed = await repository.claimGenerating({
      id: new mongoose.Types.ObjectId().toHexString(),
      analysisId: ANALYSIS,
      userId: ANA,
      createdAt: NOW,
    });
    expect(claimed.outcome).toBe('claimed');
    expect(outbox.appended).toHaveLength(1);

    const again = await repository.claimGenerating({
      id: new mongoose.Types.ObjectId().toHexString(),
      analysisId: ANALYSIS,
      userId: ANA,
      createdAt: NOW,
    });
    expect(again.outcome).toBe('exists');
    expect(outbox.appended).toHaveLength(1);
  });
});
