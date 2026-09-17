import { describe, expect, it } from 'vitest';
import { ipLimitGroup } from './client-ip';

describe('ipLimitGroup', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:cb00:7107', '203.0.113.7'],
  ])('keeps IPv4 %s as %s', (ip, group) => {
    expect(ipLimitGroup(ip)).toBe(group);
  });

  it.each([
    ['2001:db8:abcd:12:1:2:3:4', '2001:db8:abcd:12::/64'],
    ['2001:0DB8:ABCD:0012::ff', '2001:db8:abcd:12::/64'],
    ['2001:db8:abcd:12::', '2001:db8:abcd:12::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['64:ff9b::198.51.100.1', '64:ff9b:0:0::/64'],
  ])('groups IPv6 %s by its /64 prefix', (ip, group) => {
    expect(ipLimitGroup(ip)).toBe(group);
  });

  it('puts two addresses of the same /64 in one group and different /64 in different groups', () => {
    expect(ipLimitGroup('2001:db8:1:2:aaaa::1')).toBe(
      ipLimitGroup('2001:db8:1:2:bbbb::2'),
    );
    expect(ipLimitGroup('2001:db8:1:2::1')).not.toBe(
      ipLimitGroup('2001:db8:1:3::1'),
    );
  });

  it.each([
    '',
    'unknown',
    '999.1.1.1',
    '1:2:3',
    'gggg::1',
    '1::2::3',
    '1:2:3:4:5:6:7:8::9',
    '1:2:3:4:5:6:7::8:9',
  ])('keeps an unrecognized value %j as its own group', (ip) => {
    expect(ipLimitGroup(ip)).toBe(ip);
  });
});
