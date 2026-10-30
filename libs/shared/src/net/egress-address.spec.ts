import { describe, expect, it } from 'vitest';
import { classifyAddress, classifyHost } from './egress-address';

/**
 * Las tablas están copiadas a mano de la spec `links/egress-guard`; este fichero no importa ninguna tabla de la
 * implementación, para que un rango que falte en el código no desaparezca también del test.
 */
describe('classifyAddress (IPv4)', () => {
  const nonPublic: ReadonlyArray<readonly [string, string, string, string]> = [
    // [rango, primera, intermedia, última] y la clase va en el mapa de abajo
    ['0.0.0.0/8', '0.0.0.0', '0.1.2.3', '0.255.255.255'],
    ['10.0.0.0/8', '10.0.0.0', '10.20.30.40', '10.255.255.255'],
    ['100.64.0.0/10', '100.64.0.0', '100.100.100.100', '100.127.255.255'],
    ['127.0.0.0/8', '127.0.0.0', '127.0.0.1', '127.255.255.255'],
    ['169.254.0.0/16', '169.254.0.0', '169.254.169.254', '169.254.255.255'],
    ['172.16.0.0/12', '172.16.0.0', '172.20.1.1', '172.31.255.255'],
    ['192.0.0.0/24', '192.0.0.0', '192.0.0.8', '192.0.0.255'],
    ['192.0.2.0/24', '192.0.2.0', '192.0.2.77', '192.0.2.255'],
    ['192.168.0.0/16', '192.168.0.0', '192.168.1.1', '192.168.255.255'],
    ['198.18.0.0/15', '198.18.0.0', '198.19.1.1', '198.19.255.255'],
    ['198.51.100.0/24', '198.51.100.0', '198.51.100.9', '198.51.100.255'],
    ['203.0.113.0/24', '203.0.113.0', '203.0.113.9', '203.0.113.255'],
    ['224.0.0.0/4', '224.0.0.0', '230.1.1.1', '239.255.255.255'],
    ['240.0.0.0/4', '240.0.0.0', '250.1.1.1', '255.255.255.254'],
  ];
  const expectedClass: Record<string, string> = {
    '0.0.0.0/8': 'unspecified',
    '10.0.0.0/8': 'private',
    '100.64.0.0/10': 'shared_cgnat',
    '127.0.0.0/8': 'loopback',
    '169.254.0.0/16': 'link_local',
    '172.16.0.0/12': 'private',
    '192.0.0.0/24': 'reserved',
    '192.0.2.0/24': 'documentation',
    '192.168.0.0/16': 'private',
    '198.18.0.0/15': 'reserved',
    '198.51.100.0/24': 'documentation',
    '203.0.113.0/24': 'documentation',
    '224.0.0.0/4': 'multicast',
    '240.0.0.0/4': 'reserved',
  };
  // Vecinos inmediatos de cada borde: deben ser públicos.
  const justOutside = [
    '1.0.0.0',
    '9.255.255.255',
    '11.0.0.0',
    '100.63.255.255',
    '100.128.0.0',
    '126.255.255.255',
    '128.0.0.0',
    '169.253.255.255',
    '169.255.0.0',
    '172.15.255.255',
    '172.32.0.0',
    '192.0.1.0',
    '192.0.3.0',
    '192.167.255.255',
    '192.169.0.0',
    '198.17.255.255',
    '198.20.0.0',
    '198.51.99.255',
    '198.51.101.0',
    '203.0.112.255',
    '203.0.114.0',
    '223.255.255.255',
  ];

  it('classifies every non-public IPv4 range of the spec', () => {
    for (const [range, first, middle, last] of nonPublic) {
      const expected = expectedClass[range];
      expect(classifyAddress(first), `${range} first`).toBe(expected);
      expect(classifyAddress(middle), `${range} middle`).toBe(expected);
      expect(classifyAddress(last), `${range} last`).toBe(expected);
    }
  });

  it('classifies a public IPv4 address as public', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '93.184.216.34',
      '151.101.1.1',
      ...justOutside,
    ]) {
      expect(classifyAddress(address), address).toBe('public');
    }
  });

  it('classifies the limited broadcast address as broadcast', () => {
    expect(classifyAddress('255.255.255.255')).toBe('broadcast');
  });
});

describe('classifyAddress (IPv6)', () => {
  const nonPublic: ReadonlyArray<readonly [string, string, string]> = [
    ['::', '::', 'unspecified'],
    ['::1', '::1', 'loopback'],
    ['::/96 (low)', '::2', 'ipv4_mapped'],
    ['::/96 (compat)', '::8.8.8.8', 'ipv4_mapped'],
    ['100::/64', '100::1', 'reserved'],
    ['100::/64 (last)', '100::ffff:ffff:ffff:ffff', 'reserved'],
    ['2001::/23', '2001::1', 'reserved'],
    ['2001::/23 (teredo)', '2001:0:4136:e378:8000:63bf:3fff:fdd2', 'reserved'],
    ['2001::/23 (last)', '2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff', 'reserved'],
    ['2001:db8::/32', '2001:db8::1', 'documentation'],
    ['2001:db8::/32 (last)', '2001:db8:ffff::1', 'documentation'],
    ['3fff::/20', '3fff::1', 'documentation'],
    ['3fff::/20 (last)', '3fff:fff:ffff::1', 'documentation'],
    ['fc00::/7', 'fc00::1', 'ula'],
    ['fc00::/7 (fd)', 'fd12:3456:789a::1', 'ula'],
    ['fe80::/10', 'fe80::1', 'link_local'],
    ['fe80::/10 (last)', 'febf::1', 'link_local'],
    ['fec0::/10', 'fec0::1', 'reserved'],
    ['ff00::/8', 'ff02::1', 'multicast'],
  ];

  it('classifies every non-public IPv6 range of the spec', () => {
    for (const [range, address, expected] of nonPublic) {
      expect(classifyAddress(address), `${range} ${address}`).toBe(expected);
    }
  });

  it('classifies public IPv6 addresses inside 2000::/3 as public', () => {
    for (const address of [
      '2606:4700:4700::1111',
      '2a00:1450:4001:81b::200e',
      '2001:200::1',
      '2001:4860:4860::8888',
      '3ffe::1',
      '3fff:1000::1',
      '3fff:2000::1',
    ]) {
      expect(classifyAddress(address), address).toBe('public');
    }
  });

  it('rejects an IPv6 address outside 2000::/3 that is not a translation prefix', () => {
    for (const address of [
      '4000::1',
      '8000::1',
      'c000::1',
      '1fff::1',
      '0200::1',
      '64:ff9b:1::1',
      '64:ff9b::1:0:0',
    ]) {
      expect(classifyAddress(address), address).toBe('reserved');
    }
  });

  it('rejects an IPv4-mapped IPv6 address whatever it embeds', () => {
    for (const address of [
      '::ffff:127.0.0.1',
      '::ffff:8.8.8.8',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '::ffff:808:808',
      '0:0:0:0:0:ffff:a00:1',
    ]) {
      expect(classifyAddress(address), address).toBe('ipv4_mapped');
    }
  });

  it('classifies a translated IPv6 address by its embedded IPv4', () => {
    // NAT64 (64:ff9b::/96)
    expect(classifyAddress('64:ff9b::808:808')).toBe('public');
    expect(classifyAddress('64:ff9b::8.8.8.8')).toBe('public');
    expect(classifyAddress('64:ff9b::a00:1')).toBe('private');
    expect(classifyAddress('64:ff9b::7f00:1')).toBe('loopback');
    expect(classifyAddress('64:ff9b::a9fe:a9fe')).toBe('link_local');
    // 6to4 (2002::/16)
    expect(classifyAddress('2002:808:808::1')).toBe('public');
    expect(classifyAddress('2002:a00:1::1')).toBe('private');
    expect(classifyAddress('2002:7f00:1::1')).toBe('loopback');
    expect(classifyAddress('2002:c0a8:101::1')).toBe('private');
  });

  it('treats text that is not an address as reserved', () => {
    expect(classifyAddress('not-an-ip')).toBe('reserved');
    expect(classifyAddress('')).toBe('reserved');
  });
});

describe('classifyHost', () => {
  it('treats a single-label host as dotless with or without a trailing dot', () => {
    expect(classifyHost('intranet')).toEqual({ kind: 'dotless' });
    expect(classifyHost('intranet.')).toEqual({ kind: 'dotless' });
    expect(classifyHost('svc-db')).toEqual({ kind: 'dotless' });
    expect(classifyHost('example.com')).toEqual({ kind: 'name' });
    expect(classifyHost('example.com.')).toEqual({ kind: 'name' });
  });

  it('treats localhost subdomains as localhost', () => {
    expect(classifyHost('localhost')).toEqual({ kind: 'localhost' });
    expect(classifyHost('localhost.')).toEqual({ kind: 'localhost' });
    expect(classifyHost('app.localhost')).toEqual({ kind: 'localhost' });
    expect(classifyHost('A.B.LOCALHOST')).toEqual({ kind: 'localhost' });
    expect(classifyHost('notlocalhost.com')).toEqual({ kind: 'name' });
    expect(classifyHost('localhost.example.com')).toEqual({ kind: 'name' });
  });

  it('classifies alternative IPv4 notations after WHATWG URL parsing', () => {
    for (const text of [
      'http://2130706433/',
      'http://0x7f000001/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://127.0.1/',
      'http://0x7f.1/',
    ]) {
      const { hostname } = new URL(text);
      expect(hostname, text).toBe('127.0.0.1');
      expect(classifyHost(hostname), text).toEqual({
        kind: 'ip',
        addressClass: 'loopback',
      });
    }
    expect(classifyHost(new URL('http://0x0a000001/').hostname)).toEqual({
      kind: 'ip',
      addressClass: 'private',
    });
    expect(classifyHost(new URL('http://134744072/').hostname)).toEqual({
      kind: 'ip',
      addressClass: 'public',
    });
  });

  it('classifies an IPv6 literal hostname once its brackets are stripped', () => {
    const { hostname } = new URL('http://[::1]:8080/');
    expect(hostname).toBe('[::1]');
    const stripped = hostname.slice(1, -1);
    expect(classifyHost(stripped)).toEqual({
      kind: 'ip',
      addressClass: 'loopback',
    });
    expect(classifyHost('2606:4700:4700::1111')).toEqual({
      kind: 'ip',
      addressClass: 'public',
    });
    expect(
      classifyHost(new URL('http://[::ffff:7f00:1]/').hostname.slice(1, -1)),
    ).toEqual({
      kind: 'ip',
      addressClass: 'ipv4_mapped',
    });
  });
});
