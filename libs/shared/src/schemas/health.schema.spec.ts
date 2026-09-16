import { describe, expect, it } from 'vitest';
import {
  healthLiveResponseSchema,
  healthReadinessResponseSchema,
} from './health.schema';

describe('health response schemas', () => {
  const readiness = {
    status: 'down',
    service: 'api',
    version: '0.0.0',
    checks: { mongo: { status: 'up' }, redis: { status: 'down' } },
  } as const;

  it('accepts the readiness contract', () => {
    expect(healthReadinessResponseSchema.parse(readiness)).toEqual(readiness);
  });

  it('rejects extra fields that could leak details', () => {
    expect(
      healthReadinessResponseSchema.safeParse({
        ...readiness,
        checks: {
          ...readiness.checks,
          mongo: { status: 'down', message: 'connect ECONNREFUSED' },
        },
      }).success,
    ).toBe(false);
    expect(
      healthLiveResponseSchema.safeParse({
        status: 'up',
        service: 'worker',
        version: '0.0.0',
        uri: 'mongodb://user:pass@host',
      }).success,
    ).toBe(false);
  });

  it('rejects statuses other than up and down', () => {
    expect(
      healthReadinessResponseSchema.safeParse({ ...readiness, status: 'error' })
        .success,
    ).toBe(false);
  });
});
