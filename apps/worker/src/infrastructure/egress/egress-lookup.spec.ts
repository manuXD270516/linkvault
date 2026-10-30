import type { LookupAddress } from 'node:dns';
import { PUBLIC_EGRESS_POLICY } from '@linkvault/shared/net';
import { describe, expect, it, vi } from 'vitest';
import { EgressBlockedError } from './egress-blocked-error';
import {
  createEgressLookup,
  type EgressLookup,
  type EgressResolver,
} from './egress-lookup';

const PUBLIC_V4: LookupAddress = { address: '93.184.216.34', family: 4 };
const PUBLIC_V6: LookupAddress = {
  address: '2606:4700:4700::1111',
  family: 6,
};
const LOOPBACK: LookupAddress = { address: '127.0.0.1', family: 4 };

type Outcome = {
  error: NodeJS.ErrnoException | null;
  address: string | LookupAddress[];
  family?: number;
};

function run(
  lookup: EgressLookup,
  options: Parameters<EgressLookup>[1] = {},
): Promise<Outcome> {
  return new Promise((resolve) => {
    lookup('example.test', options, (error, address, family) =>
      resolve({ error, address, family }),
    );
  });
}

function resolverOf(addresses: LookupAddress[]): EgressResolver {
  return vi.fn(() => Promise.resolve(addresses));
}

describe('createEgressLookup', () => {
  it('rejects when any resolved address is not public', async () => {
    const lookup = createEgressLookup(
      resolverOf([PUBLIC_V4, LOOPBACK]),
      PUBLIC_EGRESS_POLICY,
    );
    const outcome = await run(lookup, { all: true });
    expect(outcome.error).toBeInstanceOf(EgressBlockedError);
    expect((outcome.error as EgressBlockedError).category).toBe('loopback');
    expect(outcome.address).toEqual([]);
  });

  it('returns exactly the approved addresses', async () => {
    const lookup = createEgressLookup(
      resolverOf([PUBLIC_V4, PUBLIC_V6]),
      PUBLIC_EGRESS_POLICY,
    );
    const outcome = await run(lookup, { all: true });
    expect(outcome.error).toBeNull();
    expect(outcome.address).toEqual([PUBLIC_V4, PUBLIC_V6]);
    const single = await run(lookup, {});
    expect(single.address).toBe(PUBLIC_V4.address);
    expect(single.family).toBe(4);
    const v6 = await run(lookup, { family: 6 });
    expect(v6.address).toBe(PUBLIC_V6.address);
  });

  it('honours the all option', async () => {
    const lookup = createEgressLookup(
      resolverOf([PUBLIC_V4]),
      PUBLIC_EGRESS_POLICY,
    );
    expect((await run(lookup, { all: true })).address).toEqual([PUBLIC_V4]);
    expect((await run(lookup, { all: false })).address).toBe(PUBLIC_V4.address);
  });

  it('propagates a resolution failure unchanged', async () => {
    const failure: NodeJS.ErrnoException = new Error('getaddrinfo ENOTFOUND');
    failure.code = 'ENOTFOUND';
    const lookup = createEgressLookup(
      vi.fn(() => Promise.reject(failure)),
      PUBLIC_EGRESS_POLICY,
    );
    const outcome = await run(lookup, { all: true });
    expect(outcome.error).toBe(failure);
    expect(outcome.error).not.toBeInstanceOf(EgressBlockedError);
  });

  it('calls the resolver once per lookup', async () => {
    const resolver = resolverOf([PUBLIC_V4]);
    const lookup = createEgressLookup(resolver, PUBLIC_EGRESS_POLICY);
    await run(lookup, { all: true });
    expect(resolver).toHaveBeenCalledTimes(1);
    await run(lookup, { all: true });
    expect(resolver).toHaveBeenCalledTimes(2);
  });
});
