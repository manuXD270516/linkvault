import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { PUSH_SUBSCRIPTIONS_COLLECTION } from '../infrastructure/push-subscription.schemas';

// `POST /api/notifications/push-subscriptions` sobre la app completa (D7 de enrichment-egress-guard): solo se
// registran endpoints de servicios push conocidos.

const KEYS = { p256dh: 'BPublicKeyExample', auth: 'authSecretExample' };

describe('registering a push subscription', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp(
      'notifications-push-http',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  function register(endpoint: string) {
    return http.request('POST', '/api/notifications/push-subscriptions', {
      authorization: ana.authorization,
      body: { endpoint, keys: KEYS },
    });
  }

  it('an unknown push endpoint answers 400 validation_error naming endpoint and stores nothing', async () => {
    for (const endpoint of [
      'https://push.example/endpoint-1',
      'https://169.254.169.254/latest/meta-data',
      'http://fcm.googleapis.com/fcm/send/abc',
    ]) {
      const response = await register(endpoint);

      expect(response.statusCode, endpoint).toBe(400);
      expect(response.json()).toEqual({
        code: 'validation_error',
        message: 'Invalid request',
        fields: ['endpoint'],
      });
    }
    const stored = await http.connection
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .countDocuments();
    expect(stored).toBe(0);
  });

  it('a known push endpoint is registered', async () => {
    const response = await register(
      'https://fcm.googleapis.com/fcm/send/endpoint-1',
    );

    expect(response.statusCode).toBe(201);
    const stored = await http.connection
      .collection(PUSH_SUBSCRIPTIONS_COLLECTION)
      .countDocuments();
    expect(stored).toBe(1);
  });
});
