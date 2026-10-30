import { describe, expect, it } from 'vitest';
import { isKnownPushEndpoint } from './push-services';

describe('isKnownPushEndpoint', () => {
  it('accepts the exact host and its subdomains', () => {
    expect(isKnownPushEndpoint('https://fcm.googleapis.com/fcm/send/abc')).toBe(
      true,
    );
    expect(isKnownPushEndpoint('https://web.push.apple.com/QGx')).toBe(true);
  });

  it('rejects text that is not a url', () => {
    expect(isKnownPushEndpoint('')).toBe(false);
    expect(isKnownPushEndpoint('not-a-url')).toBe(false);
  });
});
