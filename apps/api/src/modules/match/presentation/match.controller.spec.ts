import { Writable } from 'node:stream';
import {
  apiErrorResponseSchema,
  matchAnalysisResponseSchema,
  matchLatestSchema,
  matchRequestAcceptedSchema,
  type CvDocument,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { Logger } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import {
  acceptedBody,
  analysisBody,
  createMatchTestApp,
  reusedBody,
  type MatchTestApp,
  type TestPerson,
} from '../../../test-support/match-test-app';
import { ApplicationFitScores } from '../../applications/application/application-fit-scores';
import { LinksModule } from '../../links/presentation/links.module';
import { CvAnalysisCounts } from '../../cv/application/cv-analysis-counts';
import { CvDeletionHooks } from '../../cv/application/cv-deletion-hooks';
import { ANALYSIS_REPOSITORY } from '../application/ports/analysis-repository.port';
import { MATCH_AI_CONSENT } from '../application/ports/ai-consent.port';
import { MATCH_CLOCK } from '../application/ports/clock.port';
import { MATCH_CV_READER } from '../application/ports/cv-reader.port';
import { MATCH_JOB_READER } from '../application/ports/job-reader.port';
import { GetMatchAnalysis } from '../application/get-match-analysis.usecase';
import { RequestMatchAnalysis } from '../application/request-match-analysis.usecase';
import { sampleDegradedReport, sampleReport } from '../application/testing/match-test-doubles';
import { CvFacadeMatchCvReader } from '../infrastructure/cv-facade-match-cv-reader';
import { LinksFacadeMatchJobReader } from '../infrastructure/links-facade-match-job-reader';
import { MongoAnalysisRepository } from '../infrastructure/mongo-analysis.repository';
import { SystemMatchClock } from '../infrastructure/system-clock';
import { UsersFacadeMatchAiConsent } from '../infrastructure/users-facade-match-ai-consent';
import { MatchModule } from './match.module';
import { AI_ANALYSES_COLLECTION } from '../infrastructure/analysis.schemas';
import { JOB_LINKS_COLLECTION } from '../../links/infrastructure/link.schemas';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';

// HTTP del análisis (tareas 10.2–10.10) sobre match-test-app.

describe('match HTTP — smoke (10.2)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let cv: CvDocument;
  let linkId: string;

  beforeAll(async () => {
    http = await createMatchTestApp('match-smoke', getMongoTestUri());
    ana = await http.authenticated('Ana');
    cv = await http.uploadCv(ana);
    ({ linkId } = await http.seedOffer(ana));
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('pide un análisis y lo consulta', async () => {
    const posted = await http.requestMatch(ana, linkId);
    expect(posted.statusCode).toBe(202);
    const accepted = matchRequestAcceptedSchema.parse(acceptedBody(posted));
    expect(accepted).toMatchObject({
      linkId,
      cvId: cv.id,
      status: 'running',
      step: 'reading-job',
    });
    expect(await http.matchRequestedEvents()).toHaveLength(1);

    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(200);
    expect(got.headers['cache-control']).toBe('private, no-store');
    const body = matchAnalysisResponseSchema.parse(analysisBody(got));
    expect(body.running?.analysisId).toBe(accepted.analysisId);
    expect(body.latest).toBeUndefined();
  });
});


describe('match HTTP — POST accept and validation (10.3)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let defaultCv: CvDocument;
  let otherCv: CvDocument;
  let linkId: string;

  beforeAll(async () => {
    http = await createMatchTestApp('match-post-accept', getMongoTestUri());
    ana = await http.authenticated('Ana');
    defaultCv = await http.uploadCv(ana, { fileName: 'CV_default.pdf' });
    otherCv = await http.uploadCv(ana, {
      fileName: 'CV_other.pdf',
      isDefault: false,
    });
    // Mark other as non-default explicitly after second upload (second becomes default)
    await http.connection.collection('cv_documents').updateOne(
      { _id: new http.connection.base.Types.ObjectId(defaultCv.id) },
      { $set: { isDefault: true } },
    );
    await http.connection.collection('cv_documents').updateOne(
      { _id: new http.connection.base.Types.ObjectId(otherCv.id) },
      { $set: { isDefault: false } },
    );
    ({ linkId } = await http.seedOffer(ana));
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('Análisis pedido con el CV por defecto', async () => {
    const response = await http.requestMatch(ana, linkId, {});
    expect(response.statusCode).toBe(202);
    expect(matchRequestAcceptedSchema.parse(acceptedBody(response)).cvId).toBe(
      defaultCv.id,
    );
  });

  it('Análisis con otro CV mío', async () => {
    const offer = await http.seedOffer(ana, { slug: 'otro-cv' });
    const response = await http.requestMatch(ana, offer.linkId, {
      cvId: otherCv.id,
    });
    expect(response.statusCode).toBe(202);
    expect(matchRequestAcceptedSchema.parse(acceptedBody(response)).cvId).toBe(
      otherCv.id,
    );
  });

  it('rejects an unknown field with 400 validation_error', async () => {
    const response = await http.requestMatch(ana, linkId, { force: true });
    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'validation_error',
    });
  });
});

describe('match HTTP — POST link and CV rejections (10.4)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let beto: TestPerson;
  let anaCv: CvDocument;
  let betoCv: CvDocument;
  let anaLink: string;
  let betoLink: string;

  beforeAll(async () => {
    http = await createMatchTestApp('match-post-404', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    anaCv = await http.uploadCv(ana);
    betoCv = await http.uploadCv(beto);
    ({ linkId: anaLink } = await http.seedOffer(ana));
    ({ linkId: betoLink } = await http.seedOffer(beto));
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it.each([
    ['La oferta no es suya', () => betoLink],
    ['oferta inexistente', () => '66e9a0000000000000000999'],
    [':linkId mal formado', () => 'not-an-id'],
  ])('%s → 404 link_not_found same body', async (_label, linkOf) => {
    const before = await http.matchRequestedEvents();
    const response = await http.requestMatch(ana, linkOf());
    expect(response.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'link_not_found',
      message: 'Link not found',
    });
    expect(await http.matchRequestedEvents()).toHaveLength(before.length);
  });

  it('cvId de otra persona → 404 cv_not_found without outbox event', async () => {
    const before = await http.matchRequestedEvents();
    const response = await http.requestMatch(ana, anaLink, {
      cvId: betoCv.id,
    });
    expect(response.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'cv_not_found',
      message: 'CV not found',
    });
    expect(await http.matchRequestedEvents()).toHaveLength(before.length);
    expect(anaCv.id).not.toBe(betoCv.id);
  });
});


describe('match HTTP — POST 409 and 429 (10.5)', () => {
  let http: MatchTestApp;

  beforeAll(async () => {
    http = await createMatchTestApp('match-post-409', getMongoTestUri(), {
      analysesPerUser: 2,
    });
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('Todavía no hay CV', async () => {
    const beto = await http.authenticated('Beto');
    const { linkId } = await http.seedOffer(beto);
    const response = await http.requestMatch(beto, linkId);
    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe('no_cv');
    expect(await http.matchRequestedEvents()).toHaveLength(0);
  });

  it('El CV aún se está leyendo', async () => {
    const ana = await http.authenticated('AnaPending');
    await http.uploadCv(ana, { extractionStatus: 'pending' });
    const { linkId } = await http.seedOffer(ana);
    const response = await http.requestMatch(ana, linkId);
    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'cv_not_ready',
    );
  });

  it('El CV no se pudo leer', async () => {
    const ana = await http.authenticated('AnaFailed');
    await http.uploadCv(ana, { extractionStatus: 'failed' });
    const { linkId } = await http.seedOffer(ana);
    const response = await http.requestMatch(ana, linkId);
    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'cv_not_readable',
    );
  });

  it('La oferta todavía no se ha leído', async () => {
    const ana = await http.authenticated('AnaJob');
    await http.uploadCv(ana);
    const { linkId } = await http.seedOffer(ana, { ready: false });
    const response = await http.requestMatch(ana, linkId);
    expect(response.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'job_not_ready',
    );
  });

  it('Límite alcanzado with Retry-After', async () => {
    const ana = await http.authenticated('AnaQuota');
    const cv = await http.uploadCv(ana);
    for (let i = 0; i < 2; i += 1) {
      const { linkId } = await http.seedOffer(ana, { slug: `q-${i}` });
      const posted = await http.requestMatch(ana, linkId);
      expect(posted.statusCode).toBe(202);
      await http.completeAnalysis(acceptedBody(posted).analysisId, {
        report: sampleReport(),
      });
    }
    const { linkId } = await http.seedOffer(ana, { slug: 'q-over' });
    const response = await http.requestMatch(ana, linkId);
    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'too_many_attempts',
    );
    expect(response.headers['retry-after']).toMatch(/^\d+$/);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(cv.id).toBeTruthy();
  });

  it('Un rechazo no cuenta', async () => {
    const ana = await http.authenticated('AnaReject');
    const cv = await http.uploadCv(ana);
    const failedOffer = await http.seedOffer(ana, { slug: 'rej-fail' });
    const failedPost = await http.requestMatch(ana, failedOffer.linkId);
    expect(failedPost.statusCode).toBe(202);
    await http.completeAnalysis(acceptedBody(failedPost).analysisId, {
      status: 'failed',
    });
    // Fill quota with one done, then a failed should not block another
    const doneOffer = await http.seedOffer(ana, { slug: 'rej-done' });
    const donePost = await http.requestMatch(ana, doneOffer.linkId);
    expect(donePost.statusCode).toBe(202);
    await http.completeAnalysis(acceptedBody(donePost).analysisId);

    const next = await http.seedOffer(ana, { slug: 'rej-next' });
    const response = await http.requestMatch(ana, next.linkId);
    expect(response.statusCode).toBe(202);
    expect(cv.id).toBeTruthy();
  });

  it('El recuento no se puede calcular → 202', async () => {
    const ana = await http.authenticated('AnaCountFail');
    await http.uploadCv(ana);
    const { linkId } = await http.seedOffer(ana, { slug: 'count-fail' });
    const repo = http.app.get(ANALYSIS_REPOSITORY, { strict: false });
    const spy = vi
      .spyOn(repo, 'countForQuota')
      .mockRejectedValue(new Error('mongo down'));
    try {
      const response = await http.requestMatch(ana, linkId);
      expect(response.statusCode).toBe(202);
    } finally {
      spy.mockRestore();
    }
  });
});


describe('match HTTP — POST reuse (10.6)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let cv: CvDocument;
  let linkId: string;

  beforeAll(async () => {
    http = await createMatchTestApp('match-post-reuse', getMongoTestUri(), { analysesPerUser: 100 });
    ana = await http.authenticated('Ana');
    cv = await http.uploadCv(ana);
    ({ linkId } = await http.seedOffer(ana));
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('Dos peticiones seguidas', async () => {
    const offer = await http.seedOffer(ana, { slug: 'two-posts' });
    const first = await http.requestMatch(ana, offer.linkId);
    const second = await http.requestMatch(ana, offer.linkId);
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(acceptedBody(second).analysisId).toBe(acceptedBody(first).analysisId);
    const events = (await http.matchRequestedEvents()).filter(
      (e) => e.linkId === offer.linkId,
    );
    expect(events).toHaveLength(1);
  });

  it('Volver a pedir lo ya analizado → 200 MatchLatest', async () => {
    const offer = await http.seedOffer(ana, { slug: 'reuse-done' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    const report = sampleReport({
      suggestions: [
        {
          section: 'experience',
          after: 'Destaca NestJS',
          reason: 'Lo pide la oferta',
          evidence: {
            jobRequirement: 'NestJS',
            importance: 'must',
            cvFragment: 'FRAGMENTO_UNICO_CV_XYZ',
          },
        },
      ],
    });
    await http.completeAnalysis(analysisId, { report, provider: 'mock' });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(200);
    const body = matchLatestSchema.parse(reusedBody(again));
    expect(body.analysisId).toBe(analysisId);
    expect(body.status).toBe('done');
    expect(body.report?.score).toBe(report.score);
    const events = (await http.matchRequestedEvents()).filter(
      (e) => e.linkId === offer.linkId,
    );
    expect(events).toHaveLength(1);
  });

  it('Reintentar mientras la cuota de IA sigue agotada', async () => {
    const offer = await http.seedOffer(ana, { slug: 'quota-current' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    const retryAt = new Date(http.clock.now().getTime() + 60_000);
    await http.completeAnalysis(analysisId, {
      degradedReason: 'quota_exceeded',
      aiQuotaRetryAt: retryAt,
      report: sampleDegradedReport('quota_exceeded', retryAt),
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(200);
    expect(reusedBody(again).analysisId).toBe(analysisId);
  });

  it('Reintentar sin haber dado el permiso', async () => {
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      consentWouldEnable: true,
    });
    const offer = await http.seedOffer(ana, { slug: 'consent-current' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'consent_required',
      consentRequired: true,
      report: sampleDegradedReport('consent_required'),
    });
    const first = await http.requestMatch(ana, offer.linkId);
    const second = await http.requestMatch(ana, offer.linkId);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(reusedBody(first).analysisId).toBe(analysisId);
    expect(reusedBody(second).analysisId).toBe(analysisId);
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
  });

  it('Reintentar con el circuito todavía abierto', async () => {
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      consentWouldEnable: false,
    });
    const offer = await http.seedOffer(ana, { slug: 'circuit-open' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'no_providers',
      report: sampleDegradedReport('no_providers'),
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(200);
    expect(reusedBody(again).analysisId).toBe(analysisId);
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
  });

  it('Reintentar cuando la hora de vuelta ya pasó', async () => {
    const offer = await http.seedOffer(ana, { slug: 'quota-past' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    const retryAt = new Date(http.clock.now().getTime() - 1);
    await http.completeAnalysis(analysisId, {
      degradedReason: 'quota_exceeded',
      aiQuotaRetryAt: retryAt,
      report: sampleDegradedReport('quota_exceeded', retryAt),
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('Reintentar después de dar el permiso', async () => {
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      consentWouldEnable: true,
    });
    const offer = await http.seedOffer(ana, { slug: 'consent-then' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'consent_required',
      consentRequired: true,
      report: sampleDegradedReport('consent_required'),
    });
    await http.grantAiConsent(ana, true);
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('Reintentar con el circuito ya cerrado', async () => {
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: false,
      consentWouldEnable: false,
    });
    const offer = await http.seedOffer(ana, { slug: 'circuit-closed' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'no_providers',
      report: sampleDegradedReport('no_providers'),
    });
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('Reintentar un degradado porque todos fallaron', async () => {
    const offer = await http.seedOffer(ana, { slug: 'all-failed' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'providers_failed',
      report: sampleDegradedReport('providers_failed'),
    });
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('La elegibilidad no se puede consultar', async () => {
    http.eligibility.setResult({ status: 'unavailable' });
    const offer = await http.seedOffer(ana, { slug: 'elig-down' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      degradedReason: 'no_providers',
      report: sampleDegradedReport('no_providers'),
    });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
    http.eligibility.setResult({
      status: 'ready',
      hasEligible: true,
      consentWouldEnable: false,
    });
  });

  it('Volver a pedir un análisis vencido', async () => {
    const offer = await http.seedOffer(ana, { slug: 'expired' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    // Backdate requestedAt beyond maxAge
    await http.connection.collection(AI_ANALYSES_COLLECTION).updateOne(
      { _id: new http.connection.base.Types.ObjectId(analysisId) },
      {
        $set: {
          requestedAt: new Date(http.clock.now().getTime() - 200_000),
        },
      },
    );
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('Volver a pedir un análisis fallido', async () => {
    const offer = await http.seedOffer(ana, { slug: 'failed-retry' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, { status: 'failed' });
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('La oferta se completó después', async () => {
    const offer = await http.seedOffer(ana, {
      slug: 'stale-preview',
      previewVersion: 2,
    });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId);
    await http.connection.collection(JOB_LINKS_COLLECTION).updateOne(
      { _id: new http.connection.base.Types.ObjectId(offer.linkId) },
      { $set: { previewVersion: 3 } },
    );
    const again = await http.requestMatch(ana, offer.linkId);
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });

  it('Cambiar de CV', async () => {
    const other = await http.uploadCv(ana, {
      fileName: 'CV_alt.pdf',
      isDefault: false,
    });
    await http.connection.collection('cv_documents').updateOne(
      { _id: new http.connection.base.Types.ObjectId(cv.id) },
      { $set: { isDefault: true } },
    );
    await http.connection.collection('cv_documents').updateOne(
      { _id: new http.connection.base.Types.ObjectId(other.id) },
      { $set: { isDefault: false } },
    );
    const offer = await http.seedOffer(ana, { slug: 'change-cv' });
    const posted = await http.requestMatch(ana, offer.linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId);
    const again = await http.requestMatch(ana, offer.linkId, {
      cvId: other.id,
    });
    expect(again.statusCode).toBe(202);
    expect(acceptedBody(again).cvId).toBe(other.id);
    expect(acceptedBody(again).analysisId).not.toBe(analysisId);
  });
});


describe('match HTTP — GET (10.7)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let beto: TestPerson;

  beforeAll(async () => {
    http = await createMatchTestApp('match-get', getMongoTestUri(), { analysesPerUser: 100 });
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    await http.uploadCv(ana);
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('Consultar un análisis terminado', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'get-done' });
    const posted = await http.requestMatch(ana, linkId);
    const analysisId = acceptedBody(posted).analysisId;
    await http.completeAnalysis(analysisId, {
      report: sampleReport({ score: 81 }),
    });
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(200);
    expect(got.headers['cache-control']).toBe('private, no-store');
    const body = matchAnalysisResponseSchema.parse(analysisBody(got));
    expect(body.latest?.status).toBe('done');
    expect(body.latest?.report?.score).toBe(81);
    expect(body.running).toBeUndefined();
  });

  it('Consultar mientras corre el primero', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'get-running' });
    const posted = await http.requestMatch(ana, linkId);
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(200);
    const body = matchAnalysisResponseSchema.parse(analysisBody(got));
    expect(body.running?.analysisId).toBe(acceptedBody(posted).analysisId);
    expect(body.running?.maxAgeMs).toBe(120_000);
    expect(body.latest).toBeUndefined();
    expect(body.running).not.toHaveProperty('consentRequired');
    expect(body.running).not.toHaveProperty('report');
  });

  it('Reanalizar no borra de pantalla lo que se estaba leyendo', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'get-both' });
    const first = await http.requestMatch(ana, linkId);
    const firstId = acceptedBody(first).analysisId;
    await http.completeAnalysis(firstId, { report: sampleReport({ score: 55 }) });
    const other = await http.uploadCv(ana, {
      fileName: 'CV_re.pdf',
      isDefault: false,
    });
    const second = await http.requestMatch(ana, linkId, { cvId: other.id });
    const got = await http.getMatch(ana, linkId);
    const body = matchAnalysisResponseSchema.parse(analysisBody(got));
    expect(body.latest?.analysisId).toBe(firstId);
    expect(body.latest?.report?.score).toBe(55);
    expect(body.running?.analysisId).toBe(acceptedBody(second).analysisId);
  });

  it('La espera se pregunta, no se escucha', async () => {
    const cv = await http.uploadCv(ana, { fileName: 'CV_step.pdf' });
    const { linkId } = await http.seedOffer(ana, { slug: 'get-step' });
    const posted = await http.requestMatch(ana, linkId, { cvId: cv.id });
    expect(posted.statusCode).toBe(202);
    const analysisId = acceptedBody(posted).analysisId;
    await http.connection.collection(AI_ANALYSES_COLLECTION).updateOne(
      { _id: new http.connection.base.Types.ObjectId(analysisId) },
      { $set: { step: 'comparing-cv' } },
    );
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(200);
    expect(analysisBody(got).running?.step).toBe('comparing-cv');
  });

  it('El paso no lleva el informe', async () => {
    const cv = await http.uploadCv(ana, { fileName: 'CV_step2.pdf' });
    const { linkId } = await http.seedOffer(ana, { slug: 'get-step-clean' });
    const posted = await http.requestMatch(ana, linkId, { cvId: cv.id });
    expect(posted.statusCode).toBe(202);
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(200);
    const running = analysisBody(got).running;
    expect(running).toBeDefined();
    expect(JSON.stringify(running)).not.toMatch(/score|suggestions|TypeScript/);
  });

  it('Nunca pedí este análisis → analysis_not_found', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'get-none' });
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(got.json()).code).toBe(
      'analysis_not_found',
    );
  });

  it('link_not_found distinguishable and even with prior analysis', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'get-gone' });
    const posted = await http.requestMatch(ana, linkId);
    await http.completeAnalysis(acceptedBody(posted).analysisId);
    // Remove Ana's access by deleting user_links
    await http.connection.collection('user_links').deleteMany({
      userId: new http.connection.base.Types.ObjectId(ana.userId),
      linkId: new http.connection.base.Types.ObjectId(linkId),
    });
    const got = await http.getMatch(ana, linkId);
    expect(got.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(got.json()).code).toBe('link_not_found');

    const foreign = await http.getMatch(beto, linkId);
    expect(foreign.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(foreign.json()).code).toBe(
      'link_not_found',
    );
  });
});

describe('match HTTP — privacy (10.8)', () => {
  let http: MatchTestApp;
  let ana: TestPerson;
  let beto: TestPerson;
  const CV_TEXT = 'TEXTO_LARGO_DEL_CV_PRIVADO_DE_ANA_NO_DEBE_SALIR';
  const FRAGMENT = 'FRAGMENTO_CV_VISIBLE_OK';

  beforeAll(async () => {
    http = await createMatchTestApp('match-privacy', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    await http.uploadCv(ana, { extractedText: CV_TEXT });
    await http.uploadCv(beto);
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('El análisis no se comparte con el grupo', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'priv-share' });
    await http.shareInGroup(ana, beto, linkId);
    const posted = await http.requestMatch(ana, linkId);
    await http.completeAnalysis(acceptedBody(posted).analysisId, {
      report: sampleReport({
        suggestions: [
          {
            section: 'skills',
            after: 'Menciona Nest',
            reason: 'Lo pide',
            evidence: {
              jobRequirement: 'NestJS',
              importance: 'must',
              cvFragment: FRAGMENT,
            },
          },
        ],
      }),
    });
    const anaGet = await http.getMatch(ana, linkId);
    expect(anaGet.statusCode).toBe(200);
    expect(JSON.stringify(anaGet.json())).toContain(FRAGMENT);
    expect(JSON.stringify(anaGet.json())).not.toContain(CV_TEXT);

    const betoGet = await http.getMatch(beto, linkId);
    expect(betoGet.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(betoGet.json()).code).toBe(
      'analysis_not_found',
    );
  });

  it('La respuesta no arrastra el prompt', async () => {
    const { linkId } = await http.seedOffer(ana, { slug: 'priv-prompt' });
    const posted = await http.requestMatch(ana, linkId);
    await http.completeAnalysis(acceptedBody(posted).analysisId);
    const bodies = [
      JSON.stringify((await http.requestMatch(ana, linkId)).json()),
      JSON.stringify((await http.getMatch(ana, linkId)).json()),
      JSON.stringify(
        (
          await http.request('GET', '/api/cv', {
            authorization: ana.authorization,
          })
        ).json(),
      ),
    ];
    for (const body of bodies) {
      expect(body).not.toContain(CV_TEXT);
      expect(body).not.toMatch(/You are|system prompt|providerApiKey|sk-/i);
    }
  });
});


describe('match HTTP — logging (10.9)', () => {
  let lines: string[];
  let http: MatchTestApp;
  let ana: TestPerson;
  const CV_TEXT = 'CLAVE_CV_EN_LOGS_NO_DEBE_APARECER_XYZ';
  const REPORT_TEXT = 'SUGERENCIA_QUE_NO_VA_AL_LOG';

  beforeAll(async () => {
    lines = [];
    const capture = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString('utf8'));
        callback();
      },
    });
    http = await createMatchTestApp('match-logging', getMongoTestUri(), {
      logDestination: capture,
      analysesPerUser: 100,
    });
    ana = await http.authenticated('Ana');
    await http.uploadCv(ana, { extractedText: CV_TEXT });
  }, 60_000);

  afterAll(async () => {
    await http?.close();
  });

  it('Los registros no filtran el CV', async () => {
    const before = lines.join('').length;
    const debugSpy = vi.spyOn(Logger.prototype, 'debug');
    const { linkId } = await http.seedOffer(ana, { slug: 'log-safe' });
    const posted = await http.requestMatch(ana, linkId);
    const analysisId = acceptedBody(posted).analysisId;
    const cvId = acceptedBody(posted).cvId;
    await http.completeAnalysis(analysisId, {
      provider: 'openrouter',
      wentExternal: true,
      degradedReason: 'quota_exceeded',
      aiQuotaRetryAt: new Date(http.clock.now().getTime() + 3_600_000),
      report: sampleDegradedReport(
        'quota_exceeded',
        new Date(http.clock.now().getTime() + 3_600_000),
      ),
    });
    await http.connection.collection(AI_ANALYSES_COLLECTION).updateOne(
      { _id: new http.connection.base.Types.ObjectId(analysisId) },
      {
        $set: {
          'report.suggestions': [
            {
              section: 'skills',
              after: REPORT_TEXT,
              reason: 'x',
              evidence: {
                jobRequirement: 'NestJS',
                importance: 'must',
                cvFragment: null,
              },
            },
          ],
          durationMs: 12_345,
          provider: 'openrouter',
          degradedReason: 'quota_exceeded',
        },
      },
    );
    await http.getMatch(ana, linkId);
    await http.requestMatch(ana, linkId);

    const written = lines.join('').slice(before);
    expect(written).not.toContain(CV_TEXT);
    expect(written).not.toContain(REPORT_TEXT);
    expect(written).not.toMatch(/sk-|providerApiKey|BEGIN OPENROUTER/i);

    const debugPayload = JSON.stringify(debugSpy.mock.calls);
    expect(debugPayload).toContain(analysisId);
    expect(debugPayload).toContain(linkId);
    expect(debugPayload).toContain(cvId);
    expect(debugPayload).toContain('openrouter');
    expect(debugPayload).toContain('quota_exceeded');
    expect(debugPayload).toContain('12345');
    expect(debugPayload).toContain('suggestionCount');
    expect(debugPayload).not.toContain(CV_TEXT);
    expect(debugPayload).not.toContain(REPORT_TEXT);
    debugSpy.mockRestore();
  });
});

describe('MatchModule wiring and public inventory (10.10)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: (() => {
        const url = new URL(getMongoTestUri());
        url.pathname = `/match-di-${randomUUID()}`;
        return url.toString();
      })(),
    });
    app = await createApp(config, apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get<Connection>(getConnectionToken()).asPromise();
  }, 60_000);

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app?.close();
  });

  it('resolves match use cases and port adapters', () => {
    expect(app.get(RequestMatchAnalysis, { strict: false })).toBeInstanceOf(
      RequestMatchAnalysis,
    );
    expect(app.get(GetMatchAnalysis, { strict: false })).toBeInstanceOf(
      GetMatchAnalysis,
    );
    expect(app.get(ANALYSIS_REPOSITORY, { strict: false })).toBeInstanceOf(
      MongoAnalysisRepository,
    );
    expect(app.get(MATCH_JOB_READER, { strict: false })).toBeInstanceOf(
      LinksFacadeMatchJobReader,
    );
    expect(app.get(MATCH_CV_READER, { strict: false })).toBeInstanceOf(
      CvFacadeMatchCvReader,
    );
    expect(app.get(MATCH_AI_CONSENT, { strict: false })).toBeInstanceOf(
      UsersFacadeMatchAiConsent,
    );
    expect(app.get(MATCH_CLOCK, { strict: false })).toBeInstanceOf(
      SystemMatchClock,
    );
  });

  it('registers CV deletion purge, analysis-count and fit-score readers on init', async () => {
    const hooks = app.get(CvDeletionHooks, { strict: false });
    const counts = app.get(CvAnalysisCounts, { strict: false });
    const fitScores = app.get(ApplicationFitScores, { strict: false });
    expect(hooks.size).toBeGreaterThanOrEqual(1);
    // El lector real está cableado: un userId mal formado no revienta y devuelve mapa (no el default silencioso a medias).
    await expect(
      counts.countsByCv('66e9a0000000000000000a01'),
    ).resolves.toBeInstanceOf(Map);
    expect(fitScores.registered).toBe(true);
    await expect(
      fitScores.scoresFor('66e9a0000000000000000a01', []),
    ).resolves.toEqual(new Map());
  });

  it('shares the one LinksModule that AppModule builds', () => {
    const linksModules = [...app.get(ModulesContainer).values()].filter(
      (module) => module.metatype === LinksModule,
    );
    expect(linksModules).toHaveLength(1);
    const matchModules = [...app.get(ModulesContainer).values()].filter(
      (module) => module.metatype === MatchModule,
    );
    expect(matchModules).toHaveLength(1);
  });

  it.each([
    ['POST', '/api/links/66e9a0000000000000000001/match'],
    ['GET', '/api/links/66e9a0000000000000000001/match'],
  ])('answers 401 to %s %s without a token', async (method, url) => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      payload: method === 'POST' ? {} : undefined,
    });
    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'unauthorized',
      message: 'Authentication required',
    });
  });

  it('Nada del análisis en lo público', async () => {
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.statusCode).toBe(200);
    const matchProbe = await app.inject({
      method: 'GET',
      url: '/api/links/66e9a0000000000000000001/match',
    });
    expect(matchProbe.statusCode).toBe(401);
    expect(JSON.stringify(matchProbe.json())).not.toMatch(/analysis|score|cvFragment/i);
  });
});
