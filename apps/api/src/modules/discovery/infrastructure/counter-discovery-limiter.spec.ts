import { describe, expect, it } from 'vitest';
import type { FixedWindowCounter } from '../../../infrastructure/limits/fixed-window-counter';
import { InMemoryFixedWindowCounter } from '../../../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  CounterDiscoveryLimiter,
  DISCOVERY_USER_LIMIT,
} from './counter-discovery-limiter';

describe('CounterDiscoveryLimiter', () => {
  it('allows up to 30 then denies', async () => {
    const limiter = new CounterDiscoveryLimiter(
      new InMemoryFixedWindowCounter(),
    );
    for (let i = 0; i < DISCOVERY_USER_LIMIT; i += 1) {
      expect(await limiter.consume('u1')).toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    }
    expect(await limiter.consume('u1')).toMatchObject({ allowed: false });
  });

  it('fails open when the counter returns null', async () => {
    const counter: FixedWindowCounter = {
      consume: () => Promise.resolve(null),
      reset: () => Promise.resolve(false),
      giveBack: () => Promise.resolve(false),
    };
    const limiter = new CounterDiscoveryLimiter(counter);
    expect(await limiter.consume('u1')).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });
});
