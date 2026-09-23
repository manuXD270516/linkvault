import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { Application } from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { applicationWith } from '../../../testing/applications-testing';
import { SessionStore } from '../auth/session.store';
import { ApplicationsApi } from './applications.api';

describe('ApplicationsApi', () => {
  let api: ApplicationsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(ApplicationsApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('sends optional groupId when changing status from a group view', async () => {
    const updated: Application = applicationWith({ status: 'applied', version: 3 });
    const result = api.changeStatus('a-l1', {
      status: 'applied',
      version: 2,
      groupId: 'g1',
    });

    const request = http.expectOne({ method: 'PATCH', url: '/api/applications/a-l1/status' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    expect(request.request.body).toEqual({
      status: 'applied',
      version: 2,
      groupId: 'g1',
    });
    request.flush(updated);

    await expect(result).resolves.toEqual(updated);
  });

  it('omits groupId when changing status outside a group', async () => {
    const result = api.changeStatus('a-l1', { status: 'offer', version: 1 });

    const request = http.expectOne('/api/applications/a-l1/status');
    expect(request.request.body).toEqual({ status: 'offer', version: 1 });
    request.flush(applicationWith({ status: 'offer', version: 2 }));

    await expect(result).resolves.toEqual(expect.objectContaining({ status: 'offer' }));
  });

  it('GET /api/applications/analytics returns the funnel shape', async () => {
    const body = {
      byStatus: {
        saved: 0,
        interested: 0,
        applied: 1,
        in_process: 0,
        offer: 0,
        accepted: 0,
        rejected: 0,
        withdrawn: 0,
        expired: 0,
      },
      openCount: 1,
      closedCount: 0,
      acceptedCount: 0,
      stale: [],
    };
    const result = api.analytics();

    const request = http.expectOne({ method: 'GET', url: '/api/applications/analytics' });
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush(body);

    await expect(result).resolves.toEqual(body);
  });
});
