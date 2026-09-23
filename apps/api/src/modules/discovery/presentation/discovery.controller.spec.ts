import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import { DISCOVERY_USER_LIMIT } from '../infrastructure/counter-discovery-limiter';
import {
  createDiscoveryTestApp,
  type DiscoveryTestApp,
  type DiscoveryTestMember,
} from '../../../test-support/discovery-test-app';

describe('GET /api/discovery/search', () => {
  let http: DiscoveryTestApp;
  let ana: DiscoveryTestMember;

  beforeAll(async () => {
    http = await createDiscoveryTestApp(
      'discovery-search-http',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  it('returns 200 with results for getonboard', async () => {
    const response = await http.request(
      'GET',
      '/api/discovery/search?q=react&board=getonboard&page=1&pageSize=10',
      { authorization: ana.authorization },
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      results: unknown[];
      page: number;
      pageSize: number;
    }>();
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.length).toBeLessThanOrEqual(10);
  });

  it('returns 401 without auth', async () => {
    const response = await http.request('GET', '/api/discovery/search?q=x');
    expect(response.statusCode).toBe(401);
  });

  it('returns 429 when user exceeds 30/min', async () => {
    const counter = new InMemoryFixedWindowCounter();
    const limited = await createDiscoveryTestApp(
      'discovery-rl',
      getMongoTestUri(),
      { counter },
    );
    const user = await limited.authenticated('Limited');
    for (let i = 0; i < DISCOVERY_USER_LIMIT; i += 1) {
      const ok = await limited.request('GET', '/api/discovery/search?q=', {
        authorization: user.authorization,
      });
      expect(ok.statusCode).toBe(200);
    }
    const blocked = await limited.request('GET', '/api/discovery/search?q=', {
      authorization: user.authorization,
    });
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(blocked.headers['retry-after']).toBeDefined();
    await limited.close();
  });
});

describe('GET /api/discovery/search flag off', () => {
  let http: DiscoveryTestApp;
  let ana: DiscoveryTestMember;

  beforeAll(async () => {
    http = await createDiscoveryTestApp(
      'discovery-flag-off',
      getMongoTestUri(),
      { featureDiscovery: false },
    );
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  it('returns 503 discovery_disabled', async () => {
    const response = await http.request('GET', '/api/discovery/search?q=x', {
      authorization: ana.authorization,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'discovery_disabled' });
  });
});
