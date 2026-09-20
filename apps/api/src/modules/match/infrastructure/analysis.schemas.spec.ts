import { randomUUID } from 'node:crypto';
import {
  MATCH_CV_FRAGMENT_MAX_CHARS,
  MATCH_STEPS,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  AI_ANALYSES_COLLECTION,
  ANALYSIS_LINK_FINISHED_KEY,
  ANALYSIS_MODEL_NAME,
  ANALYSIS_USER_CV_KEY,
  ANALYSIS_USER_FINISHED_KEY,
  analysisSchema,
  type AnalysisDocument,
} from './analysis.schemas';

// Schema de `ai_analyses` (tarea 8.6) contra el MongoMemoryReplSet del preset de @linkvault/testing.

let connection: Connection;

const now = new Date('2026-09-20T12:00:00.000Z');
const USER_ID = new mongoose.Types.ObjectId();
const LINK_ID = new mongoose.Types.ObjectId();
const CV_ID = new mongoose.Types.ObjectId();

function analysisDoc(
  overrides: Partial<Omit<AnalysisDocument, '_id'>> = {},
): Omit<AnalysisDocument, '_id'> {
  return {
    userId: USER_ID,
    linkId: LINK_ID,
    cvId: CV_ID,
    status: 'running',
    step: 'reading-job',
    previewVersion: 1,
    promptVersion: 'v1',
    consentRequired: false,
    wentExternal: false,
    requestedAt: now,
    ...overrides,
  };
}

async function writeError(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `ai-analyses-schemas-${randomUUID()}`,
    })
    .asPromise();
  connection.model<AnalysisDocument>(ANALYSIS_MODEL_NAME, analysisSchema);
  await connection.model(ANALYSIS_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(AI_ANALYSES_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('ai_analyses collection', () => {
  it('declares bufferCommands false and the three indexes of 8.6', async () => {
    expect(analysisSchema.get('bufferCommands')).toBe(false);
    const indexes = await connection
      .collection(AI_ANALYSES_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { ...ANALYSIS_LINK_FINISHED_KEY } }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { ...ANALYSIS_USER_FINISHED_KEY } }),
    );
    expect(indexes).toContainEqual(
      expect.objectContaining({ key: { ...ANALYSIS_USER_CV_KEY } }),
    );
  });

  it.each([
    ['userId', 'userId'],
    ['linkId', 'linkId'],
    ['cvId', 'cvId'],
    ['status', 'status'],
    ['step', 'step'],
    ['previewVersion', 'previewVersion'],
    ['promptVersion', 'promptVersion'],
    ['requestedAt', 'requestedAt'],
  ])('requires %s', async (_name, field) => {
    const model = connection.model<AnalysisDocument>(ANALYSIS_MODEL_NAME);
    const document: Record<string, unknown> = { ...analysisDoc() };
    delete document[field];

    const error = await writeError(
      model.create(document as unknown as Omit<AnalysisDocument, '_id'>),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
  });

  it('keeps the reached step among its fields with the closed set', () => {
    const stepPath = analysisSchema.path('step');
    expect(stepPath).toBeDefined();
    expect(
      (stepPath as { enumValues?: string[] }).enumValues ??
        (stepPath as { options?: { enum?: string[] } }).options?.enum,
    ).toEqual([...MATCH_STEPS]);
  });

  it('does not declare cvText, jobText, prompt or credential fields', () => {
    const paths = Object.keys(analysisSchema.paths);
    expect(paths).not.toContain('cvText');
    expect(paths).not.toContain('jobText');
    expect(paths).not.toContain('prompt');
    expect(paths).not.toContain('apiKey');
    expect(paths).not.toContain('credential');
    expect(paths).not.toContain('authorization');
  });

  it(`acota evidence.cvFragment a ${String(MATCH_CV_FRAGMENT_MAX_CHARS)}`, async () => {
    const model = connection.model<AnalysisDocument>(ANALYSIS_MODEL_NAME);
    const error = await writeError(
      model.create({
        ...analysisDoc({
          status: 'done',
          step: 'done',
          degraded: false,
          finishedAt: now,
          durationMs: 1,
          report: {
            score: 10,
            matchedSkills: [],
            missingSkills: [],
            suggestions: [
              {
                section: 'skills',
                after: 'TypeScript',
                reason: 'faltaba',
                evidence: {
                  jobRequirement: 'TypeScript',
                  importance: 'must',
                  cvFragment: 'x'.repeat(MATCH_CV_FRAGMENT_MAX_CHARS + 1),
                },
              },
            ],
            degraded: false,
          },
        }),
      }),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
  });
});
