import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  MatchAnalysisResponse,
  MatchLatest,
  MatchRequestAccepted,
  MatchReport,
} from '@linkvault/shared';
import {
  apiError,
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { MatchApi } from './match.api';

const DATE = '2026-09-20T12:00:00.000Z';

const report: MatchReport = {
  score: 72,
  matchedSkills: ['TypeScript'],
  missingSkills: [{ name: 'Kubernetes', importance: 'nice' }],
  suggestions: [
    {
      section: 'Experience',
      after: 'Built APIs in TypeScript for three years.',
      reason: 'The role requires TypeScript.',
      evidence: {
        jobRequirement: 'TypeScript',
        importance: 'must',
        cvFragment: '3 years of TypeScript',
      },
    },
  ],
  degraded: false,
};

const accepted: MatchRequestAccepted = {
  analysisId: 'a1',
  linkId: 'l1',
  cvId: 'c1',
  status: 'running',
  step: 'reading-job',
  requestedAt: DATE,
};

const latestDone: MatchLatest = {
  analysisId: 'a1',
  cvId: 'c1',
  status: 'done',
  step: 'done',
  requestedAt: DATE,
  analyzedAt: DATE,
  stale: false,
  cvChanged: false,
  consentRequired: false,
  report,
};

const analysis: MatchAnalysisResponse = {
  linkId: 'l1',
  latest: latestDone,
  running: {
    analysisId: 'a2',
    cvId: 'c1',
    status: 'running',
    step: 'comparing-cv',
    requestedAt: DATE,
    maxAgeMs: 120_000,
  },
};

describe('MatchApi', () => {
  let api: MatchApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(MatchApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  function expectRequest(
    method: string,
    url: string,
  ): ReturnType<HttpTestingController['expectOne']> {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    return request;
  }

  it('accepts a new analysis with 202', async () => {
    const result = api.request('l1');

    const request = expectRequest('POST', '/api/links/l1/match');
    expect(request.request.body).toEqual({});
    request.flush(accepted, { status: 202, statusText: 'Accepted' });

    await expect(result).resolves.toEqual(accepted);
  });

  it('returns the reused report with 200', async () => {
    const result = api.request('l 2', 'cv 1');

    const request = expectRequest('POST', '/api/links/l%202/match');
    expect(request.request.body).toEqual({ cvId: 'cv 1' });
    request.flush(latestDone, { status: 200, statusText: 'OK' });

    await expect(result).resolves.toEqual(latestDone);
  });

  it('loads the dual blocks of an analysis', async () => {
    const result = api.get('l1');

    expectRequest('GET', '/api/links/l1/match').flush(analysis);

    await expect(result).resolves.toEqual(analysis);
  });

  it.each([
    ['link_not_found', 404, 'POST'],
    ['analysis_not_found', 404, 'GET'],
    ['no_cv', 409, 'POST'],
    ['cv_not_ready', 409, 'POST'],
    ['cv_not_readable', 409, 'POST'],
    ['job_not_ready', 409, 'POST'],
    ['internal_error', 500, 'POST'],
  ] as const)('propagates %s as %s on %s', async (code, status, method) => {
    const result = method === 'POST' ? api.request('l1') : api.get('l1');

    const { body, options } = apiError(code, status);
    expectRequest(method, '/api/links/l1/match').flush(body, options);

    await expect(result).rejects.toMatchObject({ status, error: { code } });
  });

  it('propagates the rate limit with its Retry-After', async () => {
    const result = api.request('l1');

    const { body, options } = apiError('too_many_attempts', 429, {
      'Retry-After': '900',
    });
    expectRequest('POST', '/api/links/l1/match').flush(body, options);

    await expect(result).rejects.toMatchObject({ status: 429 });
  });
});
