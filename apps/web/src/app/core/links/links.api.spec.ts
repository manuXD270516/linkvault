import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ImportLinksResponse, JobLinkSummary, LinkPage, SaveLinkResponse } from '@linkvault/shared';
import { providePageTesting, sessionWith } from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { LinksApi } from './links.api';

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'pending',
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const page: LinkPage = { items: [link], total: 1 };

const saved: SaveLinkResponse = {
  link,
  created: true,
  shared: 'created',
  alreadyInGroups: [],
};

const imported: ImportLinksResponse = {
  created: 2,
  existing: 1,
  unrecognized: 0,
  skipped: 0,
  links: [link],
};

describe('LinksApi', () => {
  let api: LinksApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: providePageTesting() });
    api = TestBed.inject(LinksApi);
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(SessionStore).setSession(sessionWith('token-1'));
  });

  afterEach(() => http.verify());

  /** Toda petición de links lleva el Bearer que pone el interceptor. */
  function expectRequest(
    method: string,
    url: string,
  ): ReturnType<HttpTestingController['expectOne']> {
    const request = http.expectOne(url);
    expect(request.request.method).toBe(method);
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-1');
    return request;
  }

  it('saves a link in a group', async () => {
    const result = api.saveLink('https://ejemplo.test/oferta', 'g1');

    const request = expectRequest('POST', '/api/links');
    expect(request.request.body).toEqual({ url: 'https://ejemplo.test/oferta', groupId: 'g1' });
    request.flush(saved, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(saved);
  });

  it('saves a private link without groupId', async () => {
    const result = api.saveLink('https://ejemplo.test/oferta');

    const request = expectRequest('POST', '/api/links');
    expect(request.request.body).toEqual({ url: 'https://ejemplo.test/oferta' });
    request.flush(saved, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(saved);
  });

  it('imports a pasted text', async () => {
    const result = api.importLinks('mira esto https://ejemplo.test/oferta', 'g1');

    const request = expectRequest('POST', '/api/links/import');
    expect(request.request.body).toEqual({
      text: 'mira esto https://ejemplo.test/oferta',
      groupId: 'g1',
    });
    request.flush(imported, { status: 201, statusText: 'Created' });

    await expect(result).resolves.toEqual(imported);
  });

  it('lists the links of a group with the default page size', async () => {
    const result = api.listGroupLinks('g1');

    expectRequest('GET', '/api/groups/g1/links?limit=20').flush(page);

    await expect(result).resolves.toEqual(page);
  });

  it('sends the opaque cursor of the next page', async () => {
    const result = api.listGroupLinks('g1', { limit: 50, cursor: 'Y3Vyc29y' });

    expectRequest('GET', '/api/groups/g1/links?limit=50&cursor=Y3Vyc29y').flush(page);

    await expect(result).resolves.toEqual(page);
  });

  it('lists the private links', async () => {
    const result = api.listMyLinks();

    expectRequest('GET', '/api/links/mine?limit=20').flush(page);

    await expect(result).resolves.toEqual(page);
  });

  it('removes a link from a group', async () => {
    const result = api.removeGroupLink('g1', 'l1');

    expectRequest('DELETE', '/api/groups/g1/links/l1').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('removes a link from the private list', async () => {
    const result = api.removeMyLink('l1');

    expectRequest('DELETE', '/api/links/mine/l1').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('escapes the identifiers of the path', async () => {
    const result = api.removeGroupLink('g 1', 'l/1');

    expectRequest('DELETE', '/api/groups/g%201/links/l%2F1').flush(null, {
      status: 204,
      statusText: 'No Content',
    });

    await expect(result).resolves.toBeUndefined();
  });

  it('propagates the API error without swallowing it', async () => {
    const result = api.saveLink('no-es-una-url', 'g1');

    expectRequest('POST', '/api/links').flush(
      { code: 'invalid_url', message: 'Invalid url' },
      { status: 400, statusText: 'Bad Request' },
    );

    await expect(result).rejects.toMatchObject({ status: 400 });
  });
});
