import { describe, expect, it } from 'vitest';
import {
  capabilitiesResponseSchema,
  strictCapabilitiesResponseSchema,
} from './capabilities.schema';

describe('capabilities response schemas', () => {
  const body = { search: true, discovery: false };

  it('accepts the two booleans', () => {
    expect(capabilitiesResponseSchema.parse(body)).toEqual(body);
    expect(strictCapabilitiesResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects a non-boolean value', () => {
    expect(
      capabilitiesResponseSchema.safeParse({ search: 'yes', discovery: false })
        .success,
    ).toBe(false);
    expect(capabilitiesResponseSchema.safeParse({ search: true }).success).toBe(
      false,
    );
  });

  it('client schema accepts and strips an unknown key', () => {
    expect(capabilitiesResponseSchema.parse({ ...body, push: true })).toEqual(
      body,
    );
  });

  it('strict schema rejects an unknown key', () => {
    expect(
      strictCapabilitiesResponseSchema.safeParse({ ...body, meiliHost: 'x' })
        .success,
    ).toBe(false);
  });
});
