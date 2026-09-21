import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { RoadmapAccepted, RoadmapResponse } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { RoadmapApi } from './roadmap.api';

const generating: RoadmapAccepted = {
  roadmapId: 'r1',
  status: 'generating',
};

const ready: RoadmapResponse = {
  roadmapId: 'r1',
  analysisId: 'a1',
  status: 'ready',
  items: [
    {
      skill: 'Kubernetes',
      priority: 1,
      estimatedWeeks: 2,
      resources: [
        {
          type: 'course',
          title: 'K8s 101',
          url: 'https://example.com/k8s',
          provider: 'Catalog',
          free: true,
          verified: true,
        },
      ],
    },
  ],
};

describe('RoadmapApi', () => {
  let api: RoadmapApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(RoadmapApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('POSTs to request a roadmap', async () => {
    const pending = api.request('a 1');
    const request = http.expectOne({ method: 'POST', url: '/api/analyses/a%201/roadmap' });
    expect(request.request.body).toEqual({});
    request.flush(generating, { status: 202, statusText: 'Accepted' });
    await expect(pending).resolves.toEqual(generating);
  });

  it('GETs the roadmap status', async () => {
    const pending = api.get('a1');
    http.expectOne({ method: 'GET', url: '/api/analyses/a1/roadmap' }).flush(ready);
    await expect(pending).resolves.toEqual(ready);
  });

  it('GETs markdown as text', async () => {
    const pending = api.getMarkdown('a1');
    const request = http.expectOne({ method: 'GET', url: '/api/analyses/a1/roadmap.md' });
    expect(request.request.responseType).toBe('text');
    request.flush('# Study roadmap\n', {
      headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
    });
    await expect(pending).resolves.toBe('# Study roadmap\n');
  });
});
