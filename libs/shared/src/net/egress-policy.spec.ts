import { describe, expect, it } from 'vitest';
import type { AddressClass, HostClass } from './egress-address';
import { PUBLIC_EGRESS_POLICY } from './egress-policy';

const NON_PUBLIC_CLASSES: readonly AddressClass[] = [
  'loopback',
  'private',
  'link_local',
  'shared_cgnat',
  'unspecified',
  'multicast',
  'broadcast',
  'reserved',
  'documentation',
  'ipv4_mapped',
  'ula',
];

const NAME: HostClass = { kind: 'name' };
const PUBLIC_LITERAL: HostClass = { kind: 'ip', addressClass: 'public' };

describe('PUBLIC_EGRESS_POLICY', () => {
  it('the public policy allows only names and public literals', () => {
    expect(PUBLIC_EGRESS_POLICY.allowsHost(NAME)).toBe(true);
    expect(PUBLIC_EGRESS_POLICY.allowsHost(PUBLIC_LITERAL)).toBe(true);
    expect(PUBLIC_EGRESS_POLICY.allowsHost({ kind: 'dotless' })).toBe(false);
    expect(PUBLIC_EGRESS_POLICY.allowsHost({ kind: 'localhost' })).toBe(false);
    for (const addressClass of NON_PUBLIC_CLASSES) {
      expect(
        PUBLIC_EGRESS_POLICY.allowsHost({ kind: 'ip', addressClass }),
        addressClass,
      ).toBe(false);
    }
  });

  it('the public policy allows only public addresses', () => {
    expect(PUBLIC_EGRESS_POLICY.allowsAddress('public')).toBe(true);
    for (const addressClass of NON_PUBLIC_CLASSES) {
      expect(
        PUBLIC_EGRESS_POLICY.allowsAddress(addressClass),
        addressClass,
      ).toBe(false);
    }
  });

  it('allows the default port and explicit 80 and 443 in every representation', () => {
    const representations: ReadonlyArray<string | number | undefined> = [
      '',
      undefined,
      '80',
      80,
      '443',
      443,
    ];
    for (const protocol of ['http:', 'https:']) {
      for (const hostClass of [NAME, PUBLIC_LITERAL]) {
        for (const port of representations) {
          expect(
            PUBLIC_EGRESS_POLICY.allowsPort(protocol, port, hostClass),
            `${protocol} ${String(port)} ${hostClass.kind}`,
          ).toBe(true);
        }
      }
    }
  });

  it('rejects any other port whatever the host class', () => {
    const hosts: readonly HostClass[] = [
      NAME,
      PUBLIC_LITERAL,
      { kind: 'dotless' },
      { kind: 'localhost' },
      { kind: 'ip', addressClass: 'private' },
    ];
    for (const hostClass of hosts) {
      for (const port of [
        '8080',
        8080,
        '81',
        '22',
        22,
        '6379',
        '0',
        0,
        '8',
        '4430',
        '080',
        '00443',
        ' 80',
      ]) {
        expect(
          PUBLIC_EGRESS_POLICY.allowsPort('https:', port, hostClass),
          `${String(port)} ${hostClass.kind}`,
        ).toBe(false);
        expect(
          PUBLIC_EGRESS_POLICY.allowsPort('http:', port, hostClass),
          `${String(port)} ${hostClass.kind}`,
        ).toBe(false);
      }
    }
  });
});
