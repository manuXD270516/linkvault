import { HttpTestingController } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type {
  CommentPage,
  CommentsSummary,
  CreateCommentResponse,
  GroupLinkComment,
  ImportLinksResponse,
  JobLinkSummary,
  LinkPage,
  PublicShare,
  SaveLinkResponse,
} from '@linkvault/shared';
import {
  providePageTesting,
  sessionWith,
  verifyNoPendingRequests,
} from '../../../testing/auth-testing';
import { SessionStore } from '../auth/session.store';
import { LinksApi } from './links.api';

const link: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678/?utm_source=share',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
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

const comment: GroupLinkComment = {
  id: 'c1',
  author: { userId: 'u2', displayName: 'Beto' },
  authorLeft: false,
  text: 'Piden inglés C1',
  createdAt: '2026-09-19T10:00:00.000Z',
};

const summary: CommentsSummary = {
  count: 1,
  revision: 1,
  sharedAt: '2026-09-17T10:00:00.000Z',
  latest: [comment],
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

  afterEach(() => verifyNoPendingRequests(http));

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

  it('sends a pasted description with the header written apart', async () => {
    const result = api.pasteDescription('l1', { text: 'Buscamos backend…', title: 'Backend Engineer' });

    const request = expectRequest('POST', '/api/links/l1/pasted');
    expect(request.request.body).toEqual({ text: 'Buscamos backend…', title: 'Backend Engineer' });
    request.flush(link);

    await expect(result).resolves.toEqual(link);
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

  describe('group comments', () => {
    it('saves a link with a note for the group', async () => {
      const result = api.saveLink('https://ejemplo.test/oferta', 'g1', 'Esta es la que te dije');

      const request = expectRequest('POST', '/api/links');
      expect(request.request.body).toEqual({
        url: 'https://ejemplo.test/oferta',
        groupId: 'g1',
        note: 'Esta es la que te dije',
      });
      request.flush(saved, { status: 201, statusText: 'Created' });

      await expect(result).resolves.toEqual(saved);
    });

    /** Una nota en blanco es "no enviada", y sin grupo no hay a quién dejarla: en ninguno de los dos casos viaja. */
    it('never sends a blank note or a note without a group', async () => {
      const blank = api.saveLink('https://ejemplo.test/oferta', 'g1', '   ');
      const blankRequest = expectRequest('POST', '/api/links');
      expect(blankRequest.request.body).toEqual({ url: 'https://ejemplo.test/oferta', groupId: 'g1' });
      blankRequest.flush(saved, { status: 201, statusText: 'Created' });
      await blank;

      const privateLink = api.saveLink('https://ejemplo.test/oferta', undefined, 'Nota');
      const privateRequest = expectRequest('POST', '/api/links');
      expect(privateRequest.request.body).toEqual({ url: 'https://ejemplo.test/oferta' });
      privateRequest.flush(saved, { status: 201, statusText: 'Created' });
      await privateLink;
    });

    it('reads the first page of a thread', async () => {
      const result = api.comments('g1', 'l1');
      const page: CommentPage = { items: [comment], total: 1 };

      expectRequest('GET', '/api/groups/g1/links/l1/comments?limit=20').flush(page);

      await expect(result).resolves.toEqual(page);
    });

    it('reads the next page of a thread with its cursor', async () => {
      const result = api.comments('g1', 'l1', { cursor: 'Y3Vyc29y' });
      const page: CommentPage = { items: [comment], total: 21 };

      expectRequest('GET', '/api/groups/g1/links/l1/comments?limit=20&cursor=Y3Vyc29y').flush(page);

      await expect(result).resolves.toEqual(page);
    });

    it('posts a comment and returns it with the new summary', async () => {
      const result = api.postComment('g1', 'l1', 'Piden inglés C1');
      const response: CreateCommentResponse = { comment, comments: summary };

      const request = expectRequest('POST', '/api/groups/g1/links/l1/comments');
      expect(request.request.body).toEqual({ text: 'Piden inglés C1' });
      request.flush(response, { status: 201, statusText: 'Created' });

      await expect(result).resolves.toEqual(response);
    });

    it('deletes a comment and returns the new summary', async () => {
      const result = api.deleteComment('g1', 'l1', 'c1');
      const after: CommentsSummary = { ...summary, count: 0, revision: 2, latest: [] };

      expectRequest('DELETE', '/api/groups/g1/links/l1/comments/c1').flush({ comments: after });

      await expect(result).resolves.toEqual({ comments: after });
    });

    it('removes the note of a link', async () => {
      const result = api.removeNote('g1', 'l1');

      expectRequest('DELETE', '/api/groups/g1/links/l1/note').flush(null, {
        status: 204,
        statusText: 'No Content',
      });

      await expect(result).resolves.toBeUndefined();
    });

    it('escapes the identifiers of the comment paths', async () => {
      const result = api.deleteComment('g 1', 'l/1', 'c?1');

      expectRequest('DELETE', '/api/groups/g%201/links/l%2F1/comments/c%3F1').flush({ comments: summary });

      await expect(result).resolves.toEqual({ comments: summary });
    });

    it('publishes the public link of a group link', async () => {
      const share: PublicShare = {
        slug: 'k3m9qrtv2xyz',
        url: 'http://localhost:3000/p/k3m9qrtv2xyz',
        publishedAt: '2026-09-19T10:00:00.000Z',
      };
      const result = api.publishGroupLink('g1', 'l1');

      expectRequest('PUT', '/api/groups/g1/links/l1/public').flush(share);

      await expect(result).resolves.toEqual(share);
    });

    it('unpublishes the public link of a group link', async () => {
      const result = api.unpublishGroupLink('g1', 'l1');

      expectRequest('DELETE', '/api/groups/g1/links/l1/public').flush(null, {
        status: 204,
        statusText: 'No Content',
      });

      await expect(result).resolves.toBeUndefined();
    });

    it('escapes the identifiers of the public link path', async () => {
      const result = api.unpublishGroupLink('g 1', 'l/1');

      expectRequest('DELETE', '/api/groups/g%201/links/l%2F1/public').flush(null, {
        status: 204,
        statusText: 'No Content',
      });

      await expect(result).resolves.toBeUndefined();
    });

    it('propagates the 403 of someone who cannot flip the switch', async () => {
      const result = api.publishGroupLink('g1', 'l1');

      expectRequest('PUT', '/api/groups/g1/links/l1/public').flush(
        { code: 'forbidden', message: 'Forbidden' },
        { status: 403, statusText: 'Forbidden' },
      );

      await expect(result).rejects.toMatchObject({ status: 403 });
    });

    it('propagates comment_not_found to the caller', async () => {
      const result = api.deleteComment('g1', 'l1', 'c1');

      expectRequest('DELETE', '/api/groups/g1/links/l1/comments/c1').flush(
        { code: 'comment_not_found', message: 'Comment not found' },
        { status: 404, statusText: 'Not Found' },
      );

      await expect(result).rejects.toMatchObject({ status: 404 });
    });
  });
});
