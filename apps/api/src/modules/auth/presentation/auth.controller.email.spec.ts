import { randomUUID } from 'node:crypto';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri, RedisPingDouble } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  authPost,
  createAuthTestApp,
  type AuthTestApp,
} from '../../../test-support/auth-test-app';

const PASSWORD = 'correct-horse-battery';

describe('AuthController email verification and recovery', () => {
  let redis: RedisPingDouble;
  let harness: AuthTestApp;

  beforeAll(async () => {
    redis = await RedisPingDouble.start('up');
    harness = await createAuthTestApp({
      mongoUri: getMongoTestUri(),
      redisUrl: redis.url,
    });
  });

  afterAll(async () => {
    await harness.close();
    await redis.close();
  });

  it('Forgot-password público: sin Bearer responde 200 (anti-enum)', async () => {
    const response = await authPost(harness.app, 'forgot-password', {
      body: { email: `nobody-${randomUUID()}@example.com` },
      remoteAddress: '198.51.100.40',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ message: expect.any(String) });
  });

  it('Verify-email/resend sin Authorization → 401', async () => {
    const response = await authPost(harness.app, 'verify-email/resend', {
      body: {},
      remoteAddress: '198.51.100.41',
    });

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'unauthorized',
    );
  });
});
