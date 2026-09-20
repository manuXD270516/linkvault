import { randomUUID } from 'node:crypto';
import {
  MATCH_REQUESTED_EVENT_TYPE,
  type MatchReport,
} from '@linkvault/shared';
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
  vi,
} from 'vitest';
import {
  OUTBOX_EVENTS_COLLECTION,
  OUTBOX_EVENT_MODEL_NAME,
  outboxEventSchema,
  type OutboxEventDocument,
} from '../../../infrastructure/outbox/outbox-event.schemas';
import type {
  Outbox,
  OutboxEvent,
} from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import type { MatchAnalysis } from '../domain/analysis';
import {
  AI_ANALYSES_COLLECTION,
  ANALYSIS_MODEL_NAME,
  analysisSchema,
  type AnalysisDocument,
} from './analysis.schemas';
import { MongoAnalysisRepository } from './mongo-analysis.repository';

// Repositorio de `match` contra el MongoMemoryReplSet (tareas 8.8–8.12).

let connection: Connection;
let repository: MongoAnalysisRepository;
let outbox: RecordingOutbox;

const NOW = new Date('2026-09-20T12:00:00.000Z');
const MAX_AGE_MS = 60_000;
const WINDOW_MS = 86_400_000;
const ANA = new mongoose.Types.ObjectId().toHexString();
const BETO = new mongoose.Types.ObjectId().toHexString();
const LINK = new mongoose.Types.ObjectId().toHexString();
const OTHER_LINK = new mongoose.Types.ObjectId().toHexString();
const CV = new mongoose.Types.ObjectId().toHexString();
const OTHER_CV = new mongoose.Types.ObjectId().toHexString();

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
    .createConnection(getMongoTestUri(), {
      dbName: `ai-analyses-repo-${randomUUID()}`,
    })
    .asPromise();
  connection.model<AnalysisDocument>(ANALYSIS_MODEL_NAME, analysisSchema);
  connection.model<OutboxEventDocument>(
    OUTBOX_EVENT_MODEL_NAME,
    outboxEventSchema,
  );
  await connection.model(ANALYSIS_MODEL_NAME).init();
});

beforeEach(() => {
  outbox = new RecordingOutbox(connection);
  repository = new MongoAnalysisRepository(connection, outbox);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await connection.collection(AI_ANALYSES_COLLECTION).deleteMany({});
  await connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

function fullReport(overrides: Partial<MatchReport> = {}): MatchReport {
  return {
    score: 80,
    matchedSkills: ['TypeScript'],
    missingSkills: [],
    suggestions: [],
    degraded: false,
    ...overrides,
  };
}

async function createRunning(
  overrides: Partial<{
    userId: string;
    linkId: string;
    cvId: string;
    previewVersion: number;
    promptVersion: string;
    requestedAt: Date;
  }> = {},
): Promise<MatchAnalysis> {
  return await repository.createRunning({
    id: repository.nextId(),
    userId: overrides.userId ?? ANA,
    linkId: overrides.linkId ?? LINK,
    cvId: overrides.cvId ?? CV,
    previewVersion: overrides.previewVersion ?? 1,
    promptVersion: overrides.promptVersion ?? 'v1',
    requestedAt: overrides.requestedAt ?? NOW,
  });
}

async function seedDone(
  overrides: Partial<MatchAnalysis> & { finishedAt: Date },
): Promise<string> {
  const id = new mongoose.Types.ObjectId();
  const finishedAt = overrides.finishedAt;
  await connection.collection(AI_ANALYSES_COLLECTION).insertOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(overrides.userId ?? ANA),
    linkId: new mongoose.Types.ObjectId(overrides.linkId ?? LINK),
    cvId: new mongoose.Types.ObjectId(overrides.cvId ?? CV),
    status: 'done',
    step: overrides.degraded === true ? 'done-degraded' : 'done',
    previewVersion: overrides.previewVersion ?? 1,
    promptVersion: overrides.promptVersion ?? 'v1',
    report: overrides.report ?? fullReport(),
    degraded: overrides.degraded ?? false,
    ...(overrides.degradedReason === undefined
      ? {}
      : { degradedReason: overrides.degradedReason }),
    ...(overrides.aiQuotaRetryAt === undefined
      ? {}
      : { aiQuotaRetryAt: overrides.aiQuotaRetryAt }),
    consentRequired: overrides.consentRequired ?? false,
    wentExternal: overrides.wentExternal ?? false,
    requestedAt: overrides.requestedAt ?? NOW,
    finishedAt,
    durationMs: finishedAt.getTime() - (overrides.requestedAt ?? NOW).getTime(),
  });
  return id.toHexString();
}

async function seedFailed(finishedAt: Date): Promise<string> {
  const id = new mongoose.Types.ObjectId();
  await connection.collection(AI_ANALYSES_COLLECTION).insertOne({
    _id: id,
    userId: new mongoose.Types.ObjectId(ANA),
    linkId: new mongoose.Types.ObjectId(LINK),
    cvId: new mongoose.Types.ObjectId(CV),
    status: 'failed',
    step: 'failed',
    previewVersion: 1,
    promptVersion: 'v1',
    failureCode: 'internal_error',
    consentRequired: false,
    wentExternal: false,
    requestedAt: NOW,
    finishedAt,
    durationMs: finishedAt.getTime() - NOW.getTime(),
  });
  return id.toHexString();
}

function pendingEvents(): Promise<OutboxEventDocument[]> {
  return connection
    .collection<OutboxEventDocument>(OUTBOX_EVENTS_COLLECTION)
    .find({ publishedAt: null })
    .toArray();
}

describe('MongoAnalysisRepository.createRunning', () => {
  it('inserts the running analysis and MatchRequested.v1 in the same transaction', async () => {
    const saved = await createRunning();

    expect(saved.status).toBe('running');
    expect(saved.step).toBe('reading-job');
    const events = await pendingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(MATCH_REQUESTED_EVENT_TYPE);
    expect(events[0]?.payload).toEqual({
      analysisId: saved.id,
      userId: ANA,
      linkId: LINK,
      cvId: CV,
    });
  });

  it('leaves neither analysis nor event when the transaction cannot commit', async () => {
    vi.spyOn(outbox, 'append').mockRejectedValueOnce(new Error('mongo is down'));

    await expect(createRunning()).rejects.toThrow('mongo is down');

    await expect(
      connection.collection(AI_ANALYSES_COLLECTION).countDocuments(),
    ).resolves.toBe(0);
    await expect(pendingEvents()).resolves.toEqual([]);
  });
});

describe('MongoAnalysisRepository.findLatestResolved / findRunning', () => {
  it('Consultar un análisis terminado', async () => {
    const finishedAt = new Date(NOW.getTime() + 5_000);
    const id = await seedDone({ finishedAt });

    const latest = await repository.findLatestResolved(
      ANA,
      LINK,
      MAX_AGE_MS,
      new Date(NOW.getTime() + 10_000),
    );

    expect(latest?.id).toBe(id);
    expect(latest?.status).toBe('done');
  });

  it('Consultar mientras corre el primero', async () => {
    const running = await createRunning();

    const found = await repository.findRunning(
      ANA,
      LINK,
      MAX_AGE_MS,
      new Date(NOW.getTime() + 1_000),
    );
    const latest = await repository.findLatestResolved(
      ANA,
      LINK,
      MAX_AGE_MS,
      new Date(NOW.getTime() + 1_000),
    );

    expect(found?.id).toBe(running.id);
    expect(latest).toBeNull();
  });

  it('Reanalizar no borra de pantalla lo que se estaba leyendo', async () => {
    const olderFinished = new Date(NOW.getTime() + 5_000);
    const olderId = await seedDone({ finishedAt: olderFinished });
    const running = await createRunning({
      requestedAt: new Date(NOW.getTime() + 10_000),
    });

    const at = new Date(NOW.getTime() + 11_000);
    const latest = await repository.findLatestResolved(
      ANA,
      LINK,
      MAX_AGE_MS,
      at,
    );
    const current = await repository.findRunning(ANA, LINK, MAX_AGE_MS, at);

    expect(latest?.id).toBe(olderId);
    expect(current?.id).toBe(running.id);
  });

  it('el análisis de otra persona nunca aparece', async () => {
    await createRunning();
    await seedDone({ finishedAt: new Date(NOW.getTime() + 5_000) });

    await expect(
      repository.findRunning(BETO, LINK, MAX_AGE_MS, NOW),
    ).resolves.toBeNull();
    await expect(
      repository.findLatestResolved(BETO, LINK, MAX_AGE_MS, NOW),
    ).resolves.toBeNull();
  });

  it('un running vencido se lee como failed en latest y no en running', async () => {
    const running = await createRunning();
    const afterExpiry = new Date(NOW.getTime() + MAX_AGE_MS + 1);

    const latest = await repository.findLatestResolved(
      ANA,
      LINK,
      MAX_AGE_MS,
      afterExpiry,
    );
    const current = await repository.findRunning(
      ANA,
      LINK,
      MAX_AGE_MS,
      afterExpiry,
    );

    expect(current).toBeNull();
    expect(latest).toMatchObject({
      id: running.id,
      status: 'failed',
      failureCode: 'internal_error',
    });
  });
});

describe('MongoAnalysisRepository.findReusable / findReusableDegraded', () => {
  it('reuses a done non-degraded analysis of the same trio', async () => {
    const id = await seedDone({
      finishedAt: new Date(NOW.getTime() + 5_000),
      previewVersion: 2,
      promptVersion: 'v1',
    });

    const found = await repository.findReusable(ANA, LINK, CV, 2, 'v1');

    expect(found?.id).toBe(id);
  });

  it('returns the latest degraded of the same trio with its reason', async () => {
    const retryAt = new Date(NOW.getTime() + 3_600_000);
    const id = await seedDone({
      finishedAt: new Date(NOW.getTime() + 5_000),
      degraded: true,
      degradedReason: 'quota_exceeded',
      aiQuotaRetryAt: retryAt,
      report: fullReport({
        degraded: true,
        degradedReason: 'quota_exceeded',
        suggestions: [],
        aiQuotaRetryAt: retryAt.toISOString(),
      }),
    });

    const found = await repository.findReusableDegraded(
      ANA,
      LINK,
      CV,
      1,
      'v1',
    );

    expect(found?.analysis.id).toBe(id);
    expect(found?.degradedReason).toBe('quota_exceeded');
    expect(found?.aiQuotaRetryAt).toEqual(retryAt);
  });

  it('ni un vencido ni un failed se consideran reutilizables', async () => {
    await createRunning();
    await seedFailed(new Date(NOW.getTime() + 5_000));

    await expect(
      repository.findReusable(ANA, LINK, CV, 1, 'v1'),
    ).resolves.toBeNull();
    await expect(
      repository.findReusableDegraded(ANA, LINK, CV, 1, 'v1'),
    ).resolves.toBeNull();

    const afterExpiry = new Date(NOW.getTime() + MAX_AGE_MS + 1);
    await expect(
      repository.findReusable(ANA, LINK, CV, 1, 'v1'),
    ).resolves.toBeNull();
    void afterExpiry;
  });
});

describe('MongoAnalysisRepository.countForQuota', () => {
  it('Lo consumido se cuenta, no se lleva apuntado', async () => {
    await seedDone({ finishedAt: new Date(NOW.getTime() + 1_000) });
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 2_000),
      cvId: OTHER_CV,
    });

    const quota = await repository.countForQuota(
      ANA,
      WINDOW_MS,
      MAX_AGE_MS,
      new Date(NOW.getTime() + 3_000),
    );

    expect(quota.count).toBe(2);
    expect(quota.oldest?.kind).toBe('finished');
  });

  it('Un degradado no cuenta', async () => {
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 1_000),
      degraded: true,
      degradedReason: 'no_providers',
      report: fullReport({
        degraded: true,
        degradedReason: 'no_providers',
        suggestions: [],
      }),
    });

    await expect(
      repository.countForQuota(
        ANA,
        WINDOW_MS,
        MAX_AGE_MS,
        new Date(NOW.getTime() + 2_000),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it('Una avería no se le cobra a quien la sufre', async () => {
    await seedFailed(new Date(NOW.getTime() + 1_000));
    await createRunning({
      requestedAt: new Date(NOW.getTime() - MAX_AGE_MS - 1),
    });

    await expect(
      repository.countForQuota(ANA, WINDOW_MS, MAX_AGE_MS, NOW),
    ).resolves.toEqual({ count: 0 });
  });

  it('Un análisis en curso ocupa sitio mientras corre', async () => {
    const running = await createRunning();

    const quota = await repository.countForQuota(
      ANA,
      WINDOW_MS,
      MAX_AGE_MS,
      new Date(NOW.getTime() + 1_000),
    );

    expect(quota).toEqual({
      count: 1,
      oldest: { kind: 'running', at: running.requestedAt },
    });
  });

  it('Falta el permiso y no cuenta', async () => {
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 1_000),
      degraded: true,
      degradedReason: 'consent_required',
      consentRequired: true,
      report: fullReport({
        degraded: true,
        degradedReason: 'consent_required',
        suggestions: [],
      }),
    });

    await expect(
      repository.countForQuota(
        ANA,
        WINDOW_MS,
        MAX_AGE_MS,
        new Date(NOW.getTime() + 2_000),
      ),
    ).resolves.toEqual({ count: 0 });
  });

  it('La cuota de IA agotada no quema la de análisis', async () => {
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 1_000),
      degraded: true,
      degradedReason: 'quota_exceeded',
      aiQuotaRetryAt: new Date(NOW.getTime() + 3_600_000),
      report: fullReport({
        degraded: true,
        degradedReason: 'quota_exceeded',
        suggestions: [],
        aiQuotaRetryAt: new Date(NOW.getTime() + 3_600_000).toISOString(),
      }),
    });

    await expect(
      repository.countForQuota(
        ANA,
        WINDOW_MS,
        MAX_AGE_MS,
        new Date(NOW.getTime() + 2_000),
      ),
    ).resolves.toEqual({ count: 0 });
  });
});

describe('MongoAnalysisRepository.removeByCv / countByCv', () => {
  it('Borrar el CV borra sus análisis', async () => {
    await createRunning();
    await seedDone({ finishedAt: new Date(NOW.getTime() + 1_000) });
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 2_000),
      cvId: OTHER_CV,
    });

    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        const removed = await repository.removeByCv(ANA, CV, session);
        expect(removed).toBe(2);
      });
    } finally {
      await session.endSession();
    }

    const remaining = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .find({})
      .toArray();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.['cvId'].toHexString()).toBe(OTHER_CV);
  });

  it('Borrar un CV no toca los análisis de otro', async () => {
    await seedDone({ finishedAt: new Date(NOW.getTime() + 1_000) });
    const otherId = await seedDone({
      finishedAt: new Date(NOW.getTime() + 2_000),
      cvId: OTHER_CV,
    });

    const session = await connection.startSession();
    try {
      await session.withTransaction(async () => {
        await repository.removeByCv(ANA, CV, session);
      });
    } finally {
      await session.endSession();
    }

    const left = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(otherId) });
    expect(left).not.toBeNull();
  });

  it('El recuento cuenta también los que no terminaron', async () => {
    await createRunning();
    await seedDone({ finishedAt: new Date(NOW.getTime() + 1_000) });
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 2_000),
      cvId: OTHER_CV,
    });

    const counts = await repository.countByCv(ANA);

    expect(counts.get(CV)).toBe(2);
    expect(counts.get(OTHER_CV)).toBe(1);
  });

  it('El recuento no arrastra el análisis', async () => {
    await seedDone({
      finishedAt: new Date(NOW.getTime() + 1_000),
      report: fullReport({
        suggestions: [
          {
            section: 'skills',
            after: 'SECRET_CV_FRAGMENT_xyz',
            reason: 'faltaba',
            evidence: {
              jobRequirement: 'TypeScript',
              importance: 'must',
              cvFragment: 'SECRET_CV_FRAGMENT_xyz',
            },
          },
        ],
      }),
    });

    const counts = await repository.countByCv(ANA);

    expect(counts).toBeInstanceOf(Map);
    expect([...counts.entries()]).toEqual([[CV, 1]]);
    expect(JSON.stringify([...counts.entries()])).not.toContain(
      'SECRET_CV_FRAGMENT',
    );
  });

  it('does not touch another link or person by accident', async () => {
    await createRunning({ linkId: OTHER_LINK });
    const counts = await repository.countByCv(ANA);
    expect(counts.get(CV)).toBe(1);
  });
});
