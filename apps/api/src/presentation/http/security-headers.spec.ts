import { describe, expect, it } from 'vitest';
import {
  API_SECURITY_HEADERS,
  securityHeadersOnSend,
  type SecurityHeadersReply,
} from './security-headers';

class ReplyDouble implements SecurityHeadersReply {
  readonly headers = new Map<string, string>();

  hasHeader(name: string): boolean {
    return this.headers.has(name);
  }

  header(name: string, value: string): this {
    this.headers.set(name, value);
    return this;
  }
}

describe('securityHeadersOnSend', () => {
  it('adds every default header to a response that has none', async () => {
    const reply = new ReplyDouble();

    await securityHeadersOnSend({}, reply, '{}');

    expect(Object.fromEntries(reply.headers)).toEqual({
      ...API_SECURITY_HEADERS,
    });
    expect(Object.keys(API_SECURITY_HEADERS)).toHaveLength(4);
  });

  it('does not overwrite a header the route already set', async () => {
    const reply = new ReplyDouble();
    reply.header(
      'Content-Security-Policy',
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    reply.header('Referrer-Policy', 'same-origin');

    await securityHeadersOnSend({}, reply, '{}');

    expect(reply.headers.get('Content-Security-Policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    );
    expect(reply.headers.get('Referrer-Policy')).toBe('same-origin');
    expect(reply.headers.get('X-Frame-Options')).toBe('DENY');
  });

  it('resolves to the payload untouched', async () => {
    const payload = { ok: true };

    await expect(
      securityHeadersOnSend({}, new ReplyDouble(), payload),
    ).resolves.toBe(payload);
  });
});
