import { describe, expect, it } from 'vitest';
import {
  REDIS_RETRY_MAX_DELAY_MS,
  redisRetryDelay,
} from '../redis/redis-health-client';
import {
  MONGO_RETRY_MAX_DELAY_MS,
  mongoRetryDelay,
} from './mongo-initial-connect-retry';

describe('retry backoff', () => {
  it('caps both backoffs at 2000 ms', () => {
    expect(MONGO_RETRY_MAX_DELAY_MS).toBe(2_000);
    expect(REDIS_RETRY_MAX_DELAY_MS).toBe(2_000);
  });

  it('doubles the MongoDB retry delay from 250 ms up to the cap', () => {
    expect([0, 1, 2, 3, 4, 50].map(mongoRetryDelay)).toEqual([
      250, 500, 1_000, 2_000, 2_000, 2_000,
    ]);
  });

  it('doubles the Redis retry delay from 250 ms up to the cap (ioredis counts from 1)', () => {
    expect([1, 2, 3, 4, 5, 50].map(redisRetryDelay)).toEqual([
      250, 500, 1_000, 2_000, 2_000, 2_000,
    ]);
  });

  it('never exceeds the cap', () => {
    for (let attempt = 0; attempt < 1_100; attempt += 1) {
      expect(mongoRetryDelay(attempt)).toBeLessThanOrEqual(2_000);
      expect(redisRetryDelay(attempt + 1)).toBeLessThanOrEqual(2_000);
    }
  });
});
