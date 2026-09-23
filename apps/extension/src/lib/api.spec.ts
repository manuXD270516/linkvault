import { describe, expect, it } from 'vitest';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from './csrf';
import { ExtensionApi, ApiHttpError, sessionFromAuthResponse } from './api';
import type { ExtensionSession } from './storage';

const user = {
  id: 'u1',
  email: 'ana@example.com',
  displayName: 'Ana',
};

describe('sessionFromAuthResponse', () => {
  it('calcula accessExpiresAt desde expiresIn', () => {
    const session = sessionFromAuthResponse(
      {
        accessToken: 'a1',
        refreshToken: 'r1',
        expiresIn: 900,
        user,
      },
      1_000_000,
    );
    expect(session).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      accessExpiresAt: 1_000_000 + 900_000,
      user,
    });
  });
});

describe('ExtensionApi auth headers', () => {
  it('envía X-Requested-With: linkvault en login de extensión', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse({
        accessToken: 'a1',
        refreshToken: 'r1',
        expiresIn: 900,
        user,
      });
    };
    const api = new ExtensionApi({ fetch: fetchMock });
    stubStorage();

    await api.login('ana@example.com', 'secret');

    expect(calls).toHaveLength(1);
    const first = calls[0];
    expect(first).toBeDefined();
    expect(first?.url).toContain('/api/auth/extension/login');
    const headers = new Headers(first?.init?.headers);
    expect(headers.get(CSRF_HEADER_NAME)).toBe(CSRF_HEADER_VALUE);
  });

  it('arma POST /api/links sin groupId por defecto', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.includes('/api/links')) {
        return jsonResponse({
          link: { id: 'l1' },
          created: true,
          shared: 'created',
          alreadyInGroups: [],
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const api = new ExtensionApi({ fetch: fetchMock });
    stubStorage({
      accessToken: 'a1',
      refreshToken: 'r1',
      accessExpiresAt: Date.now() + 60_000,
      user,
    });

    await api.saveLink('https://www.linkedin.com/jobs/view/123');

    expect(calls).toHaveLength(1);
    const first = calls[0];
    expect(first).toBeDefined();
    expect(JSON.parse(String(first?.init?.body))).toEqual({
      url: 'https://www.linkedin.com/jobs/view/123',
    });
    const headers = new Headers(first?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer a1');
  });

  it('sin sesión no llama a POST /api/links', async () => {
    const calls: string[] = [];
    const fetchMock: typeof fetch = async (input) => {
      calls.push(String(input));
      throw new Error(`unexpected ${String(input)}`);
    };
    const api = new ExtensionApi({ fetch: fetchMock });
    stubStorage(null);

    await expect(
      api.saveLink('https://www.linkedin.com/jobs/view/123'),
    ).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
    expect(calls).toEqual([]);
  });
});

describe('ApiHttpError', () => {
  it('expone status y code', () => {
    const error = new ApiHttpError(409, 'refresh_conflict');
    expect(error.status).toBe(409);
    expect(error.code).toBe('refresh_conflict');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubStorage(session: ExtensionSession | null = null): void {
  const store = new Map<string, unknown>();
  if (session !== null) {
    store.set('lv_ext_access_token', session.accessToken);
    store.set('lv_ext_refresh_token', session.refreshToken);
    store.set('lv_ext_access_expires_at', session.accessExpiresAt);
    store.set('lv_ext_user', session.user);
  }

  (globalThis as { chrome?: unknown }).chrome = {
    storage: {
      local: {
        async get(keys?: string | string[]) {
          const list = Array.isArray(keys) ? keys : keys === undefined ? [] : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) {
            if (store.has(key)) {
              out[key] = store.get(key);
            }
          }
          return out;
        },
        async set(items: Record<string, unknown>) {
          for (const [key, value] of Object.entries(items)) {
            store.set(key, value);
          }
        },
        async remove(keys: string | string[]) {
          for (const key of Array.isArray(keys) ? keys : [keys]) {
            store.delete(key);
          }
        },
        async clear() {
          store.clear();
        },
      },
    },
  };
}
