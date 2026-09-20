import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import mongoose from 'mongoose';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptedBody,
  createMatchTestApp,
  type MatchTestApp,
  type TestPerson,
} from '../../../test-support/match-test-app';
import { CvDeletionHooks } from '../../cv/application/cv-deletion-hooks';
import { CV_DOCUMENTS_COLLECTION } from '../../cv/infrastructure/cv.schemas';
import { sampleReport } from '../application/testing/match-test-doubles';
import { AI_ANALYSES_COLLECTION } from '../infrastructure/analysis.schemas';

// Borrado atómico CV → análisis (tarea 11.6 / ADR-030 §4). Sin oyente in-process de `cv.deleted`.

async function analysesOf(http: MatchTestApp, cvId: string): Promise<number> {
  return http.connection.collection(AI_ANALYSES_COLLECTION).countDocuments({
    cvId: new mongoose.Types.ObjectId(cvId),
  });
}

async function cvExists(http: MatchTestApp, cvId: string): Promise<boolean> {
  const row = await http.connection
    .collection(CV_DOCUMENTS_COLLECTION)
    .findOne({ _id: new mongoose.Types.ObjectId(cvId) });
  return row !== null;
}

async function seedAnalyses(
  http: MatchTestApp,
  person: TestPerson,
  count: number,
): Promise<{ cvId: string }> {
  const cv = await http.uploadCv(person);
  for (let i = 0; i < count; i += 1) {
    const offer = await http.seedOffer(person, {
      slug: `cascade-${cv.id.slice(-6)}-${i}-${Date.now()}`,
    });
    const posted = await http.requestMatch(person, offer.linkId);
    expect(posted.statusCode).toBe(202);
    const { analysisId } = acceptedBody(posted);
    await http.completeAnalysis(analysisId, {
      report: sampleReport({
        score: 60 + i,
        suggestions: [
          {
            section: 'skills',
            after: `SECRET_CV_FRAGMENT_${cv.id}`,
            reason: 'faltaba',
            evidence: {
              jobRequirement: 'TypeScript',
              importance: 'must',
              cvFragment: `SECRET_CV_FRAGMENT_${cv.id}`,
            },
          },
        ],
      }),
    });
  }
  return { cvId: cv.id };
}

describe('deleting a CV with match analyses (11.6)', () => {
  let http: MatchTestApp;

  beforeAll(async () => {
    http = await createMatchTestApp('cv-match-cascade', getMongoTestUri());
  }, 60_000);

  afterAll(async () => {
    await http.close();
  });

  it('El borrado se lleva los análisis del CV', async () => {
    const person = await http.authenticated('Cascade-ok');
    await http.grantAiConsent(person);
    const { cvId } = await seedAnalyses(http, person, 3);
    expect(await analysesOf(http, cvId)).toBe(3);

    const response = await http.request('DELETE', `/api/cv/${cvId}`, {
      authorization: person.authorization,
    });

    expect(response.statusCode).toBe(200);
    expect(await cvExists(http, cvId)).toBe(false);
    expect(await analysesOf(http, cvId)).toBe(0);
    const leftover = await http.connection
      .collection(AI_ANALYSES_COLLECTION)
      .find({ cvId: new mongoose.Types.ObjectId(cvId) })
      .toArray();
    expect(JSON.stringify(leftover)).not.toContain('SECRET_CV_FRAGMENT');
  });

  it('El borrado no queda a la espera de un segundo paso', async () => {
    const person = await http.authenticated('Cascade-no-second');
    await http.grantAiConsent(person);
    const { cvId } = await seedAnalyses(http, person, 1);

    await http.request('DELETE', `/api/cv/${cvId}`, {
      authorization: person.authorization,
    });

    expect(await analysesOf(http, cvId)).toBe(0);
    expect(await cvExists(http, cvId)).toBe(false);
  });

  it('Borrar un CV no toca los análisis de otro', async () => {
    const person = await http.authenticated('Cascade-other');
    await http.grantAiConsent(person);
    const doomed = await seedAnalyses(http, person, 1);
    const kept = await seedAnalyses(http, person, 2);

    await http.request('DELETE', `/api/cv/${doomed.cvId}`, {
      authorization: person.authorization,
    });

    expect(await analysesOf(http, doomed.cvId)).toBe(0);
    expect(await analysesOf(http, kept.cvId)).toBe(2);
  });
});

describe('CV deletion atomicity when a hook fails (11.6)', () => {
  let http: MatchTestApp;

  beforeAll(async () => {
    // App propia: el hook que falla se registra una vez y no contamina la suite feliz.
    http = await createMatchTestApp('cv-match-cascade-fail', getMongoTestUri());
  }, 60_000);

  afterAll(async () => {
    await http.close();
  });

  it('El borrado falla a mitad', async () => {
    const person = await http.authenticated('Cascade-fail');
    await http.grantAiConsent(person);
    const { cvId } = await seedAnalyses(http, person, 2);
    const hooks = http.app.get(CvDeletionHooks, { strict: false });
    hooks.register({
      deleteRelationsOf: () =>
        Promise.reject(new Error('Forced failure mid-cascade')),
    });

    const response = await http.request('DELETE', `/api/cv/${cvId}`, {
      authorization: person.authorization,
    });

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(await cvExists(http, cvId)).toBe(true);
    expect(await analysesOf(http, cvId)).toBe(2);
  });
});

describe('CV deletion retry after a mid-failure (11.6)', () => {
  let http: MatchTestApp;

  beforeAll(async () => {
    http = await createMatchTestApp('cv-match-cascade-retry', getMongoTestUri());
  }, 60_000);

  afterAll(async () => {
    await http.close();
  });

  it('O se borra todo o no se borra nada', async () => {
    const person = await http.authenticated('Cascade-atomic');
    await http.grantAiConsent(person);
    const { cvId } = await seedAnalyses(http, person, 2);
    const hooks = http.app.get(CvDeletionHooks, { strict: false });
    let attempts = 0;
    hooks.register({
      deleteRelationsOf: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('first attempt fails'))
          : Promise.resolve();
      },
    });

    const failed = await http.request('DELETE', `/api/cv/${cvId}`, {
      authorization: person.authorization,
    });
    expect(failed.statusCode).toBeGreaterThanOrEqual(500);
    expect(await cvExists(http, cvId)).toBe(true);
    expect(await analysesOf(http, cvId)).toBe(2);

    const ok = await http.request('DELETE', `/api/cv/${cvId}`, {
      authorization: person.authorization,
    });
    expect(ok.statusCode).toBe(200);
    expect(await cvExists(http, cvId)).toBe(false);
    expect(await analysesOf(http, cvId)).toBe(0);
  });
});

describe('match has no in-process cv.deleted listener (11.7)', () => {
  it('no production file in match listens for cv.deleted', () => {
    const listens =
      /(?:OnEvent|@OnEvent)\([^)]*cv\.deleted|EventEmitter2[^;]*cv\.deleted/;
    const offenders = filesUnder(join(import.meta.dirname, '..')).filter(
      (file) =>
        !file.endsWith('.spec.ts') &&
        listens.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...filesUnder(path));
    } else if (entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}
