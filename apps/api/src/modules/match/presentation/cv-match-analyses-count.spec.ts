import {
  cvListResponseSchema,
  type CvDocument,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acceptedBody,
  createMatchTestApp,
  type MatchTestApp,
  type TestPerson,
} from '../../../test-support/match-test-app';
import { sampleReport } from '../application/testing/match-test-doubles';
import { AI_ANALYSES_COLLECTION } from '../infrastructure/analysis.schemas';

// Recuento `matchAnalysesCount` en todas las listas de CV (tarea 11.5 de cv-match-suggestions).

describe('CV list matchAnalysesCount (11.5)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let beto: TestPerson;

  beforeAll(async () => {
    http = await createMatchTestApp('cv-match-counts', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
  }, 60_000);

  afterAll(async () => {
    await http.close();
  });

  async function listOf(person: TestPerson): Promise<CvDocument[]> {
    const response = await http.request('GET', '/api/cv', {
      authorization: person.authorization,
    });
    expect(response.statusCode).toBe(200);
    return cvListResponseSchema.parse(response.json()).items;
  }

  async function requestOn(
    person: TestPerson,
    linkId: string,
    status: 'done' | 'failed' | 'running' = 'done',
  ): Promise<string> {
    const posted = await http.requestMatch(person, linkId);
    expect(posted.statusCode).toBe(202);
    const { analysisId } = acceptedBody(posted);
    if (status === 'running') {
      return analysisId;
    }
    if (status === 'failed') {
      await http.completeAnalysis(analysisId, { status: 'failed' });
      return analysisId;
    }
    await http.completeAnalysis(analysisId, {
      report: sampleReport({ score: 70 }),
    });
    return analysisId;
  }

  it('Cada CV dice cuántos análisis se irían con él', async () => {
    const person = await http.authenticated('Counts-two-cvs');
    await http.grantAiConsent(person);
    const first = await http.uploadCv(person, { fileName: 'primero.pdf' });
    const second = await http.uploadCv(person, {
      fileName: 'segundo.pdf',
      isDefault: true,
    });
    const offers = await Promise.all([
      http.seedOffer(person, { slug: 'c1' }),
      http.seedOffer(person, { slug: 'c2' }),
      http.seedOffer(person, { slug: 'c3' }),
      http.seedOffer(person, { slug: 'c4' }),
    ]);

    expect(offers).toHaveLength(4);
    const firstThree = offers.slice(0, 3);
    const fourth = offers.at(3);
    if (fourth === undefined) {
      throw new Error('expected a fourth offer');
    }

    // Tres con el primero (ya no es default): requestMatch usa el CV por defecto.
    await http.request('PUT', `/api/cv/${first.id}/default`, {
      authorization: person.authorization,
    });
    for (const offer of firstThree) {
      await requestOn(person, offer.linkId);
    }
    await http.request('PUT', `/api/cv/${second.id}/default`, {
      authorization: person.authorization,
    });
    await requestOn(person, fourth.linkId);

    const items = await listOf(person);
    const byId = new Map(items.map((cv) => [cv.id, cv.matchAnalysesCount]));

    expect(byId.get(first.id)).toBe(3);
    expect(byId.get(second.id)).toBe(1);
  });

  it('Un CV sin análisis trae cero', async () => {
    const person = await http.authenticated('Counts-zero');
    const cv = await http.uploadCv(person);

    const items = await listOf(person);
    const mine = items.find((item) => item.id === cv.id);

    expect(mine).toBeDefined();
    expect(mine?.matchAnalysesCount).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(mine, 'matchAnalysesCount')).toBe(
      true,
    );
    expect(mine?.matchAnalysesCount).not.toBeNull();
  });

  it('El recuento cuenta también los que no terminaron', async () => {
    const person = await http.authenticated('Counts-mixed');
    await http.grantAiConsent(person);
    const cv = await http.uploadCv(person);
    const offers = await Promise.all([
      http.seedOffer(person, { slug: 'm1' }),
      http.seedOffer(person, { slug: 'm2' }),
      http.seedOffer(person, { slug: 'm3' }),
    ]);

    expect(offers).toHaveLength(3);
    const doneOffer = offers.at(0);
    const failedOffer = offers.at(1);
    const runningOffer = offers.at(2);
    if (
      doneOffer === undefined ||
      failedOffer === undefined ||
      runningOffer === undefined
    ) {
      throw new Error('expected three offers');
    }

    await requestOn(person, doneOffer.linkId, 'done');
    await requestOn(person, failedOffer.linkId, 'failed');
    await requestOn(person, runningOffer.linkId, 'running');

    const items = await listOf(person);
    expect(items.find((item) => item.id === cv.id)?.matchAnalysesCount).toBe(3);

    const stored = await http.connection
      .collection(AI_ANALYSES_COLLECTION)
      .countDocuments({
        cvId: new http.connection.base.Types.ObjectId(cv.id),
      });
    expect(stored).toBe(3);
  });

  it('El recuento es solo el de quien pide', async () => {
    await http.grantAiConsent(ana);
    await http.grantAiConsent(beto);
    const anaCv = await http.uploadCv(ana, { fileName: 'ana.pdf' });
    const betoCv = await http.uploadCv(beto, { fileName: 'beto.pdf' });
    const offer = await http.seedOffer(ana, { slug: 'shared-count' });
    await http.shareInGroup(ana, beto, offer.linkId);

    await requestOn(ana, offer.linkId);
    await requestOn(beto, offer.linkId);

    const anaItems = await listOf(ana);
    const betoItems = await listOf(beto);

    expect(anaItems.find((item) => item.id === anaCv.id)?.matchAnalysesCount).toBe(
      1,
    );
    expect(betoItems.find((item) => item.id === betoCv.id)?.matchAnalysesCount).toBe(
      1,
    );
    expect(anaItems.every((item) => item.matchAnalysesCount <= 1)).toBe(true);
  });

  it('El recuento no arrastra el análisis', async () => {
    const person = await http.authenticated('Counts-no-payload');
    await http.grantAiConsent(person);
    await http.uploadCv(person);
    const offer = await http.seedOffer(person, { slug: 'secret' });
    await requestOn(person, offer.linkId);

    const response = await http.request('GET', '/api/cv', {
      authorization: person.authorization,
    });
    const raw = JSON.stringify(response.json());

    expect(raw).not.toMatch(/score|suggestions|skills|cvFragment|SECRET/i);
    expect(cvListResponseSchema.parse(response.json()).items[0]?.matchAnalysesCount).toBe(
      1,
    );
  });

  it('El recuento viaja en toda lista de CV', async () => {
    const person = await http.authenticated('Counts-everywhere');
    await http.grantAiConsent(person);
    const first = await http.uploadCv(person, { fileName: 'a.pdf' });
    expect(first.matchAnalysesCount).toBe(0);

    const second = await http.uploadCv(person, { fileName: 'b.pdf' });
    const offer = await http.seedOffer(person, { slug: 'everywhere' });
    await http.request('PUT', `/api/cv/${first.id}/default`, {
      authorization: person.authorization,
    });
    await requestOn(person, offer.linkId);

    const marked = await http.request('PUT', `/api/cv/${second.id}/default`, {
      authorization: person.authorization,
    });
    expect(marked.statusCode).toBe(200);
    const markedItems = cvListResponseSchema.parse(marked.json()).items;
    expect(
      markedItems.find((item) => item.id === first.id)?.matchAnalysesCount,
    ).toBe(1);
    expect(
      markedItems.find((item) => item.id === second.id)?.matchAnalysesCount,
    ).toBe(0);

    const deleted = await http.request('DELETE', `/api/cv/${first.id}`, {
      authorization: person.authorization,
    });
    expect(deleted.statusCode).toBe(200);
    const remaining = cvListResponseSchema.parse(deleted.json()).items;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);
    expect(remaining[0]?.matchAnalysesCount).toBe(0);
  });
});
