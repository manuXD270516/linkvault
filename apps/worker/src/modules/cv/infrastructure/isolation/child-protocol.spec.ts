import { describe, expect, it } from 'vitest';
import { encodeFrame, parseFrame } from './child-protocol';

describe('child protocol', () => {
  it('round-trips the four messages', () => {
    for (const message of [
      { type: 'ready' },
      { type: 'boot_error', code: 'ERR_MODULE_NOT_FOUND' },
      { type: 'text', text: 'hola', pagesCapped: false, rawCapped: true },
      { type: 'failed', cause: 'password' },
    ] as const) {
      expect(parseFrame(encodeFrame(message).trimEnd())).toEqual({
        ok: true,
        message,
      });
    }
  });

  it('rejects a message outside the protocol', () => {
    for (const line of [
      '{"type":"hello"}',
      '{"type":"failed","cause":"timeout"}',
      '{"type":"ready","extra":1}',
      '{"type":"text","text":1,"pagesCapped":false,"rawCapped":false}',
      '[]',
      '"ready"',
      'null',
    ]) {
      expect(parseFrame(line)).toEqual({ ok: false, cause: 'protocol' });
    }
  });

  it('an invalid json line is protocol and does not throw', () => {
    expect(() => parseFrame('not json {')).not.toThrow();
    expect(parseFrame('not json {')).toEqual({ ok: false, cause: 'protocol' });
    expect(parseFrame('')).toEqual({ ok: false, cause: 'protocol' });
  });

  it('boot_error code must match the closed pattern', () => {
    for (const code of ['err_x', 'A'.repeat(65), 'A B', '', 'CANARY-X']) {
      expect(parseFrame(JSON.stringify({ type: 'boot_error', code }))).toEqual({
        ok: false,
        cause: 'protocol',
      });
    }
    expect(
      parseFrame(JSON.stringify({ type: 'boot_error', code: 'A'.repeat(64) }))
        .ok,
    ).toBe(true);
  });

  it('the protocol result carries no line text', () => {
    const result = parseFrame('{"type":"failed","cause":"CANARY-LINE-TEXT"}');

    expect(JSON.stringify(result)).not.toContain('CANARY-LINE-TEXT');
    expect(result).toEqual({ ok: false, cause: 'protocol' });
  });
});
