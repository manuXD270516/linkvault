import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { CapabilitiesApi } from './capabilities.api';

describe('CapabilitiesApi', () => {
  let api: CapabilitiesApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(CapabilitiesApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => verifyNoPendingRequests(http));

  it('requests GET /api/capabilities', async () => {
    const result = firstValueFrom(api.get());

    const request = http.expectOne('/api/capabilities');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    request.flush({ search: true, discovery: false });

    await expect(result).resolves.toEqual({ search: true, discovery: false });
  });

  it('parses a response with an unknown extra key', async () => {
    const result = firstValueFrom(api.get());

    http.expectOne('/api/capabilities').flush({
      search: false,
      discovery: true,
      push: true,
    });

    await expect(result).resolves.toEqual({ search: false, discovery: true });
  });

  it('rejects a body that does not validate', async () => {
    const result = firstValueFrom(api.get());

    http.expectOne('/api/capabilities').flush({ search: 'yes' });

    await expect(result).rejects.toBeDefined();
  });
});
