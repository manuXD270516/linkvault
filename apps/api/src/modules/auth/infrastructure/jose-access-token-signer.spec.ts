import { decodeJwt, decodeProtectedHeader, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import type { Clock } from '../domain/clock';
import { InvalidAccessToken } from '../domain/errors';
import { JoseAccessTokenSigner } from './jose-access-token-signer';

// Adaptador ACCESS_TOKEN_SIGNER (tarea 4.5 de auth-users, D3) con jose 6.

const SECRET = 'test-only-jwt-secret-at-least-32-chars';
const OTHER_SECRET = 'another-test-jwt-secret-of-32-chars!!';
const TTL = 900;
const NOW = new Date('2026-09-17T10:00:00.000Z');
const NOW_SECONDS = NOW.getTime() / 1000;
const SUBJECT = { userId: '66e9a0000000000000000001', sessionId: 'session-1' };

class MovableClock implements Clock {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

function signer(clock: Clock = new MovableClock(NOW), secret = SECRET) {
  return new JoseAccessTokenSigner({ secret, ttlSeconds: TTL }, clock);
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

/** Token firmado a mano con claims y algoritmo a elección. */
function craft(
  claims: Record<string, unknown>,
  options: { alg?: string; secret?: string } = {},
): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: options.alg ?? 'HS256', typ: 'JWT' })
    .sign(key(options.secret ?? SECRET));
}

const VALID_CLAIMS = {
  sub: SUBJECT.userId,
  sid: SUBJECT.sessionId,
  typ: 'access',
  iat: NOW_SECONDS,
  exp: NOW_SECONDS + TTL,
};

async function expectRejected(token: string, clock?: Clock): Promise<void> {
  await expect(signer(clock).verify(token)).rejects.toBeInstanceOf(
    InvalidAccessToken,
  );
}

describe('JoseAccessTokenSigner', () => {
  it('signs an HS256 token with sub, sid, typ, iat and exp', async () => {
    const { accessToken, expiresIn } = await signer().sign(SUBJECT);

    expect(expiresIn).toBe(TTL);
    expect(decodeProtectedHeader(accessToken)).toEqual({
      alg: 'HS256',
      typ: 'JWT',
    });
    expect(decodeJwt(accessToken)).toEqual({
      sub: SUBJECT.userId,
      sid: SUBJECT.sessionId,
      typ: 'access',
      iat: NOW_SECONDS,
      exp: NOW_SECONDS + TTL,
    });
  });

  it('verifies a valid token and returns its subject and iat', async () => {
    const { accessToken } = await signer().sign(SUBJECT);

    expect(await signer().verify(accessToken)).toEqual({
      ...SUBJECT,
      issuedAtSeconds: NOW_SECONDS,
    });
  });

  it('floors iat to whole seconds', async () => {
    const clock = new MovableClock(new Date(NOW.getTime() + 999));
    const { accessToken } = await signer(clock).sign(SUBJECT);

    expect(decodeJwt(accessToken).iat).toBe(NOW_SECONDS);
  });

  it('tolerates less than 5 seconds of clock skew after exp', async () => {
    const { accessToken } = await signer().sign(SUBJECT);
    const clock = new MovableClock(new Date((NOW_SECONDS + TTL + 4) * 1000));

    await expect(signer(clock).verify(accessToken)).resolves.toMatchObject(
      SUBJECT,
    );
    clock.current = new Date((NOW_SECONDS + TTL + 5) * 1000);
    await expectRejected(accessToken, clock);
  });

  it('rejects an expired token', async () => {
    const { accessToken } = await signer().sign(SUBJECT);

    await expectRejected(
      accessToken,
      new MovableClock(new Date((NOW_SECONDS + TTL + 60) * 1000)),
    );
  });

  it('rejects a token signed with another secret', async () => {
    const { accessToken } = await signer(
      new MovableClock(NOW),
      OTHER_SECRET,
    ).sign(SUBJECT);

    await expectRejected(accessToken);
  });

  it('rejects a token with alg none', async () => {
    const encode = (value: object) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');
    const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode(VALID_CLAIMS)}.`;

    await expectRejected(unsigned);
  });

  it('rejects a token signed with another HMAC algorithm and the same secret', async () => {
    await expectRejected(await craft(VALID_CLAIMS, { alg: 'HS512' }));
  });

  it.each([
    ['a different typ', { ...VALID_CLAIMS, typ: 'refresh' }],
    ['no typ', { ...VALID_CLAIMS, typ: undefined }],
    ['no sid', { ...VALID_CLAIMS, sid: undefined }],
    ['a non-string sid', { ...VALID_CLAIMS, sid: 42 }],
    ['no sub', { ...VALID_CLAIMS, sub: undefined }],
    ['no exp', { ...VALID_CLAIMS, exp: undefined }],
    ['no iat', { ...VALID_CLAIMS, iat: undefined }],
  ])('rejects a token with %s', async (_, claims) => {
    await expectRejected(await craft(claims));
  });

  it.each(['', 'not-a-jwt', 'a.b.c'])(
    'rejects the malformed token %j',
    async (token) => {
      await expectRejected(token);
    },
  );

  it('rejects a secret shorter than 32 characters', () => {
    expect(
      () =>
        new JoseAccessTokenSigner(
          { secret: 'short', ttlSeconds: TTL },
          new MovableClock(NOW),
        ),
    ).toThrow(RangeError);
  });
});
