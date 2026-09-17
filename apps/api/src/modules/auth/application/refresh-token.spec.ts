import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';

describe('refresh token', () => {
  it('generates 32 random bytes in base64url and its sha256 hash', () => {
    const { token, tokenHash } = generateRefreshToken();

    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(tokenHash).not.toContain(token);
  });

  it('never repeats a token', () => {
    const tokens = new Set(
      Array.from({ length: 100 }, () => generateRefreshToken().token),
    );

    expect(tokens.size).toBe(100);
  });

  it('hashes deterministically', () => {
    expect(hashRefreshToken('abc')).toBe(hashRefreshToken('abc'));
    expect(hashRefreshToken('abc')).not.toBe(hashRefreshToken('abd'));
  });
});
