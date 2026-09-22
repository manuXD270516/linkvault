import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { PublicPreviewResponse } from '@linkvault/shared';
import { apiError } from '../../../testing/auth-testing';
import { authInterceptor } from '../auth/auth.interceptor';
import { SessionStore } from '../auth/session.store';
import { PublicPreviewApi } from './public-preview.api';

const SLUG = 'k3m9qrtv2xyz';
const URL = `/api/public/previews/${SLUG}`;

const response: PublicPreviewResponse = {
  slug: SLUG,
  link: {
    platform: 'linkedin',
    displayUrl: 'https://www.linkedin.com/jobs/view/1',
    title: 'Backend Node.js',
  },
};

describe('PublicPreviewApi', () => {
  let http: HttpTestingController;
  let api: PublicPreviewApi;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    api = TestBed.inject(PublicPreviewApi);
  });

  afterEach(() => http.verify());

  it('reads the public preview of a slug', async () => {
    const pending = api.preview(SLUG);

    const request = http.expectOne({ method: 'GET', url: URL });
    request.flush(response);

    await expect(pending).resolves.toEqual(response);
  });

  it('never sends Authorization, not even with a session in memory', async () => {
    TestBed.inject(SessionStore).setSession({
      accessToken: 'token-1',
      expiresIn: 900,
      user: {
        id: 'u1',
        email: 'ana@example.com',
        displayName: 'Ana',
        emailVerified: true,
        aiConsent: {
    externalProviders: false,
    consentedAt: null,
    textVersion: null,
    currentTextVersion: '2026-09-20',
  },
        outputLanguage: 'es',
        redactName: false,
        createdAt: '2026-09-17T10:00:00.000Z',
      },
    });
    const pending = api.preview(SLUG);

    const request = http.expectOne(URL);
    expect(request.request.headers.has('Authorization')).toBe(false);
    request.flush(response);

    await pending;
  });

  it('rejects with the 404 of a burnt slug without trying to refresh the session', async () => {
    const pending = api.preview(SLUG);

    const { body, options } = apiError('link_not_found', 404);
    http.expectOne(URL).flush(body, options);

    await expect(pending).rejects.toMatchObject({ status: 404 });
    http.expectNone('/api/auth/refresh');
  });

  it('rejects with the 429 of the public rate limit', async () => {
    const pending = api.preview(SLUG);

    const { body, options } = apiError('too_many_attempts', 429, { 'Retry-After': '900' });
    http.expectOne(URL).flush(body, options);

    await expect(pending).rejects.toMatchObject({ status: 429 });
  });

  it('escapes the slug in the URL', async () => {
    const pending = api.preview('a/b');

    http.expectOne('/api/public/previews/a%2Fb').flush(response);

    await pending;
  });
});
