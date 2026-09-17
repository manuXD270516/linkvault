import { describe, expect, it } from 'vitest';
import type { Clock } from './clock';
import {
  REFRESH_CONFLICT_WINDOW_MS,
  RefreshSessionPolicy,
  type RefreshTokenState,
  type SessionState,
} from './refresh-session';

const DAY = 86_400_000;
const SECOND = 1_000;
const NOW = new Date('2026-09-17T10:00:00.000Z');

class FixedClock implements Clock {
  constructor(private readonly current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

const settings = { refreshTtlDays: 30, refreshMaxDays: 90 };
const policy = new RefreshSessionPolicy(new FixedClock(NOW), settings);

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function fromNow(ms: number): Date {
  return new Date(NOW.getTime() + ms);
}

function session(overrides: Partial<SessionState> = {}): SessionState {
  const createdAt = overrides.createdAt ?? ago(DAY);
  return {
    createdAt,
    expiresAt: new Date(createdAt.getTime() + 90 * DAY),
    revokedAt: null,
    ...overrides,
  };
}

function token(overrides: Partial<RefreshTokenState> = {}): RefreshTokenState {
  return { expiresAt: fromNow(29 * DAY), rotatedAt: null, ...overrides };
}

describe('RefreshSessionPolicy', () => {
  describe('openSession', () => {
    it('opens a session with the absolute maximum and a first refresh token with the sliding lifetime', () => {
      expect(policy.openSession()).toEqual({
        createdAt: NOW,
        expiresAt: fromNow(90 * DAY),
        refreshExpiresAt: fromNow(30 * DAY),
      });
    });

    it('never gives the first refresh token more life than the session', () => {
      const short = new RefreshSessionPolicy(new FixedClock(NOW), {
        refreshTtlDays: 7,
        refreshMaxDays: 7,
      });

      const window = short.openSession();

      expect(window.refreshExpiresAt).toEqual(window.expiresAt);
    });
  });

  describe('decide', () => {
    it('rotates a valid token of an active session with the sliding lifetime', () => {
      expect(policy.decide(token(), session())).toEqual({
        outcome: 'rotate',
        now: NOW,
        successorExpiresAt: fromNow(30 * DAY),
      });
    });

    it('Caducidad deslizante con máximo absoluto', () => {
      // Sesión abierta hace 80 días; último refresh hace 20 días (su token caduca dentro de 10).
      const opened = ago(80 * DAY);
      const decision = policy.decide(
        token({ expiresAt: new Date(ago(20 * DAY).getTime() + 30 * DAY) }),
        session({ createdAt: opened }),
      );

      expect(decision).toEqual({
        outcome: 'rotate',
        now: NOW,
        successorExpiresAt: new Date(opened.getTime() + 90 * DAY),
      });
    });

    it('returns conflict for a token rotated 2 seconds ago', () => {
      expect(
        policy.decide(token({ rotatedAt: ago(2 * SECOND) }), session()),
      ).toEqual({ outcome: 'conflict' });
    });

    it('returns conflict within the window even if the successor was already used', () => {
      // La regla solo mira cuándo se rotó el token presentado: el uso del sucesor no la cambia.
      const rotatedAt = ago(REFRESH_CONFLICT_WINDOW_MS - 1);

      expect(policy.decide(token({ rotatedAt }), session())).toEqual({
        outcome: 'conflict',
      });
    });

    it.each([10, 11])(
      'treats a token rotated %i seconds ago as reuse',
      (seconds) => {
        expect(
          policy.decide(token({ rotatedAt: ago(seconds * SECOND) }), session()),
        ).toEqual({ outcome: 'reuse' });
      },
    );

    it('rejects a token of a revoked session', () => {
      expect(
        policy.decide(token(), session({ revokedAt: ago(SECOND) })),
      ).toEqual({ outcome: 'invalid', reason: 'session_revoked' });
    });

    it('rejects a rotated token of a revoked session without treating it as reuse again', () => {
      expect(
        policy.decide(
          token({ rotatedAt: ago(60 * SECOND) }),
          session({ revokedAt: ago(30 * SECOND) }),
        ),
      ).toEqual({ outcome: 'invalid', reason: 'session_revoked' });
    });

    it('rejects an unknown token and a token without session', () => {
      expect(policy.decide(null, null)).toEqual({
        outcome: 'invalid',
        reason: 'unknown_token',
      });
      expect(policy.decide(token(), null)).toEqual({
        outcome: 'invalid',
        reason: 'session_missing',
      });
    });

    it.each([
      ['at', NOW],
      ['after', ago(SECOND)],
    ])('rejects a token that expires %s now', (_, expiresAt) => {
      expect(policy.decide(token({ expiresAt }), session())).toEqual({
        outcome: 'invalid',
        reason: 'token_expired',
      });
    });

    it('rejects a token of a session past its absolute maximum', () => {
      expect(
        policy.decide(
          token({ expiresAt: fromNow(DAY) }),
          session({ createdAt: ago(91 * DAY) }),
        ),
      ).toEqual({ outcome: 'invalid', reason: 'session_expired' });
    });

    it('rejects an expired token even if it was rotated inside the conflict window', () => {
      expect(
        policy.decide(
          token({ expiresAt: ago(SECOND), rotatedAt: ago(2 * SECOND) }),
          session(),
        ),
      ).toEqual({ outcome: 'invalid', reason: 'token_expired' });
    });
  });

  describe('isSessionActive', () => {
    it('is true for a live session and false when missing, revoked or expired', () => {
      expect(policy.isSessionActive(session())).toBe(true);
      expect(policy.isSessionActive(null)).toBe(false);
      expect(policy.isSessionActive(session({ revokedAt: ago(SECOND) }))).toBe(
        false,
      );
      expect(
        policy.isSessionActive(
          session({ expiresAt: NOW, createdAt: ago(DAY) }),
        ),
      ).toBe(false);
    });
  });

  it('reads the clock on every decision', () => {
    let current = NOW;
    const moving = new RefreshSessionPolicy({ now: () => current }, settings);
    const rotated = token({ rotatedAt: NOW });

    expect(moving.decide(rotated, session())).toEqual({ outcome: 'conflict' });
    current = fromNow(REFRESH_CONFLICT_WINDOW_MS);
    expect(moving.decide(rotated, session())).toEqual({ outcome: 'reuse' });
  });

  it.each([
    { refreshTtlDays: 31, refreshMaxDays: 30 },
    { refreshTtlDays: 0, refreshMaxDays: 30 },
    { refreshTtlDays: 1.5, refreshMaxDays: 30 },
  ])('rejects inconsistent settings %j', (invalid) => {
    expect(
      () => new RefreshSessionPolicy(new FixedClock(NOW), invalid),
    ).toThrow(RangeError);
  });
});
