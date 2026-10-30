import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDiscoveryTestApp,
  type DiscoveryTestApp,
  type DiscoveryTestMember,
} from '../../test-support/discovery-test-app';

// `GET /api/capabilities` sobre la app completa y el guard global real. La app de prueba de Descubrir arranca con
// `FEATURE_DISCOVERY=true` y sin búsqueda: `{ search: false, discovery: true }`.
describe('GET /api/capabilities', () => {
  let http: DiscoveryTestApp;
  let ana: DiscoveryTestMember;

  beforeAll(async () => {
    http = await createDiscoveryTestApp('capabilities-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  it('responds 401 without an access token', async () => {
    const response = await http.request('GET', '/api/capabilities');
    expect(response.statusCode).toBe(401);
  });

  it('responds 200 with the derived capabilities for a signed-in user', async () => {
    const response = await http.request('GET', '/api/capabilities', {
      authorization: ana.authorization,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ search: false, discovery: true });
  });

  it('body has exactly search and discovery, both booleans', async () => {
    const response = await http.request('GET', '/api/capabilities', {
      authorization: ana.authorization,
    });
    const body = response.json<Record<string, unknown>>();
    expect(Object.keys(body).sort()).toEqual(['discovery', 'search']);
    expect(typeof body['search']).toBe('boolean');
    expect(typeof body['discovery']).toBe('boolean');
  });

  it('sends Cache-Control private, no-store', async () => {
    const response = await http.request('GET', '/api/capabilities', {
      authorization: ana.authorization,
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
  });
});
