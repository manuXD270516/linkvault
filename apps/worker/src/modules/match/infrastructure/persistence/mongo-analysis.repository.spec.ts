import { randomUUID } from 'node:crypto';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  MovableClock,
  sampleDegradedReport,
  sampleReport,
} from '../../application/testing/match-test-doubles';
import {
  AI_ANALYSES_COLLECTION,
  ANALYSIS_MODEL_NAME,
  analysisSchema,
  type AnalysisDocument,
} from './analysis.schemas';
import { MongoAiContextReader } from './mongo-ai-context.reader';
import { MongoAnalysisRepository } from './mongo-analysis.repository';

let connection: Connection;
let clock: MovableClock;
let repository: MongoAnalysisRepository;

const USER = new mongoose.Types.ObjectId();
const LINK = new mongoose.Types.ObjectId();
const CV = new mongoose.Types.ObjectId();
const MAX_AGE_MS = 120_000;

async function insertRunning(
  overrides: Partial<AnalysisDocument> = {},
): Promise<string> {
  const created = await connection.model(ANALYSIS_MODEL_NAME).create({
    userId: USER,
    linkId: LINK,
    cvId: CV,
    status: 'running',
    step: 'reading-job',
    previewVersion: 1,
    promptVersion: 'v1',
    consentRequired: false,
    wentExternal: false,
    requestedAt: clock.now(),
    ...overrides,
  });
  return created._id.toHexString();
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `match-worker-${randomUUID()}`,
    })
    .asPromise();
  connection.model(ANALYSIS_MODEL_NAME, analysisSchema);
});

beforeAll(() => {
  clock = new MovableClock();
  repository = new MongoAnalysisRepository(connection, clock, {
    MATCH_ANALYSIS_MAX_AGE_MS: MAX_AGE_MS,
  } as never);
});

afterEach(async () => {
  clock = new MovableClock();
  repository = new MongoAnalysisRepository(connection, clock, {
    MATCH_ANALYSIS_MAX_AGE_MS: MAX_AGE_MS,
  } as never);
  await connection.collection(AI_ANALYSES_COLLECTION).deleteMany({});
  await connection.collection('users').deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('MongoAnalysisRepository.complete / fail', () => {
  it('winning write completes a running analysis', async () => {
    const id = await insertRunning();
    const written = await repository.complete(id, {
      step: 'done',
      report: sampleReport(),
      provider: 'mock',
      model: 'm',
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 10,
    });
    expect(written).toBe(true);
    expect((await repository.findById(id))?.status).toBe('done');
  });

  it('losing the race does not overwrite a finished analysis', async () => {
    const id = await insertRunning();
    await repository.complete(id, {
      step: 'done',
      report: sampleReport(),
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 1,
    });
    const second = await repository.complete(id, {
      step: 'done-degraded',
      report: sampleDegradedReport('no_providers'),
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: true,
      degradedReason: 'no_providers',
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 2,
    });
    expect(second).toBe(false);
    expect((await repository.findById(id))?.step).toBe('done');
  });

  it('losing by expiry leaves the document untouched (GET still reads failed)', async () => {
    const id = await insertRunning();
    clock.advance(MAX_AGE_MS + 1);
    const written = await repository.complete(id, {
      step: 'done',
      report: sampleReport(),
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 1,
    });
    expect(written).toBe(false);
    const raw = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(raw?.['status']).toBe('running');
  });

  it('Se purga y después llega un resultado tardío', async () => {
    const id = await insertRunning();
    await connection
      .collection(AI_ANALYSES_COLLECTION)
      .deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    const written = await repository.complete(id, {
      step: 'done',
      report: sampleReport(),
      promptVersion: 'v1',
      previewVersion: 1,
      degraded: false,
      consentRequired: false,
      wentExternal: false,
      finishedAt: clock.now(),
      durationMs: 1,
    });
    expect(written).toBe(false);
    const count = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .countDocuments();
    expect(count).toBe(0);
  });
});

describe('MongoAnalysisRepository.recordStep', () => {
  it('advances the step normally', async () => {
    const id = await insertRunning();
    expect(await repository.recordStep(id, 'comparing-cv')).toBe(true);
    expect((await repository.findById(id))?.step).toBe('comparing-cv');
  });

  it('does not write a regressing step', async () => {
    const id = await insertRunning();
    await repository.recordStep(id, 'comparing-cv');
    expect(await repository.recordStep(id, 'reading-job')).toBe(false);
    expect((await repository.findById(id))?.step).toBe('comparing-cv');
  });

  it('does not write on an already resolved analysis', async () => {
    const id = await insertRunning();
    await repository.fail(id, {
      failureCode: 'internal_error',
      finishedAt: clock.now(),
      durationMs: 1,
    });
    expect(await repository.recordStep(id, 'comparing-cv')).toBe(false);
  });

  it('does not write and does not fail on a purged analysis', async () => {
    const id = await insertRunning();
    await connection
      .collection(AI_ANALYSES_COLLECTION)
      .deleteOne({ _id: new mongoose.Types.ObjectId(id) });
    await expect(repository.recordStep(id, 'comparing-cv')).resolves.toBe(
      false,
    );
  });

  it('never stores report, score or text when recording a step', async () => {
    const id = await insertRunning();
    await repository.recordStep(id, 'comparing-cv');
    const raw = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(id) });
    expect(raw?.['report']).toBeUndefined();
    expect(raw?.['step']).toBe('comparing-cv');
    expect(JSON.stringify(raw)).not.toMatch(/TypeScript/);
  });
});

describe('MongoAiContextReader', () => {
  it('reads effective consent when current', async () => {
    const userId = new mongoose.Types.ObjectId();
    await connection.collection('users').insertOne({
      _id: userId,
      displayName: 'Ana',
      aiConsent: {
        externalProviders: true,
        textVersion: AI_CONSENT_TEXT_VERSION,
      },
      outputLanguage: 'es',
      redactName: true,
    });
    const reader = new MongoAiContextReader(connection);
    const ctx = await reader.read(userId.toHexString());
    expect(ctx.aiConsent.externalProviders).toBe(true);
    expect(ctx.personName).toBe('Ana');
  });

  it('treats consent on an older text version as false', async () => {
    const userId = new mongoose.Types.ObjectId();
    await connection.collection('users').insertOne({
      _id: userId,
      displayName: 'Ana',
      aiConsent: {
        externalProviders: true,
        textVersion: '2020-01-01',
      },
      outputLanguage: 'en',
      redactName: false,
    });
    const reader = new MongoAiContextReader(connection);
    const ctx = await reader.read(userId.toHexString());
    expect(ctx.aiConsent.externalProviders).toBe(false);
    expect(ctx.outputLanguage).toBe('en');
  });

  it('returns safe defaults when consent was never given', async () => {
    const reader = new MongoAiContextReader(connection);
    const ctx = await reader.read(new mongoose.Types.ObjectId().toHexString());
    expect(ctx).toEqual({
      aiConsent: { externalProviders: false },
      outputLanguage: 'es',
      redactName: true,
      personName: '',
    });
  });
});
