import { describe, expect, it } from 'vitest';
import {
  knowSomeoneStateSchema,
  setKnowSomeoneRequestSchema,
} from './know-someone.schema';

describe('knowSomeoneStateSchema', () => {
  it('accepts flaggedByMe and a non-negative count', () => {
    expect(
      knowSomeoneStateSchema.parse({ flaggedByMe: true, count: 2 }),
    ).toEqual({ flaggedByMe: true, count: 2 });
    expect(
      knowSomeoneStateSchema.parse({ flaggedByMe: false, count: 0 }),
    ).toEqual({ flaggedByMe: false, count: 0 });
  });

  it('rejects negative counts, fractions and unknown fields', () => {
    expect(
      knowSomeoneStateSchema.safeParse({ flaggedByMe: true, count: -1 })
        .success,
    ).toBe(false);
    expect(
      knowSomeoneStateSchema.safeParse({ flaggedByMe: true, count: 1.5 })
        .success,
    ).toBe(false);
    expect(
      knowSomeoneStateSchema.safeParse({
        flaggedByMe: true,
        count: 1,
        userIds: ['x'],
      }).success,
    ).toBe(false);
  });
});

describe('setKnowSomeoneRequestSchema', () => {
  it('accepts a boolean flagged', () => {
    expect(setKnowSomeoneRequestSchema.parse({ flagged: true })).toEqual({
      flagged: true,
    });
    expect(setKnowSomeoneRequestSchema.parse({ flagged: false })).toEqual({
      flagged: false,
    });
  });

  it('rejects missing or non-boolean flagged', () => {
    expect(setKnowSomeoneRequestSchema.safeParse({}).success).toBe(false);
    expect(
      setKnowSomeoneRequestSchema.safeParse({ flagged: 'true' }).success,
    ).toBe(false);
  });
});
