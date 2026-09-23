import { describe, expect, it } from 'vitest';
import { RefreshSessionPolicy } from '../domain/refresh-session';
import {
  InMemorySessionRepository,
  MovableClock,
} from './testing/auth-test-doubles';

describe('SessionRepository.revokeAllUserSessions', () => {
  it('revoca todas las activas del usuario y no toca las de otros', async () => {
    const clock = new MovableClock();
    const sessions = new InMemorySessionRepository(
      new RefreshSessionPolicy(clock, {
        refreshTtlDays: 30,
        refreshMaxDays: 90,
      }),
      clock,
    );

    const anaA = await sessions.open('ana', 'hash-a');
    const anaB = await sessions.open('ana', 'hash-b', 'extension');
    const beto = await sessions.open('beto', 'hash-c');

    const revoked = await sessions.revokeAllUserSessions('ana');
    expect(revoked).toBe(2);
    expect(sessions.isActive(anaA.sessionId)).toBe(false);
    expect(sessions.isActive(anaB.sessionId)).toBe(false);
    expect(sessions.isActive(beto.sessionId)).toBe(true);
  });
});
