import { RefreshSessionPolicy } from '../../domain/refresh-session';
import { SessionOpener } from '../issued-session';
import { InMemoryAttemptLimiter } from './in-memory-attempt-limiter';
import {
  FakeAccessTokenSigner,
  FakePasswordHasher,
  InMemorySessionRepository,
  InMemoryUserAccounts,
  MovableClock,
  RecordingSecurityLog,
} from './auth-test-doubles';

/** Conjunto de dobles compartidos por los tests de los use cases de `auth`, sobre un mismo reloj. */
export function createAuthTestHarness() {
  const clock = new MovableClock();
  const policy = new RefreshSessionPolicy(clock, {
    refreshTtlDays: 30,
    refreshMaxDays: 90,
  });
  const accounts = new InMemoryUserAccounts(clock);
  const hasher = new FakePasswordHasher();
  const signer = new FakeAccessTokenSigner(clock);
  const sessions = new InMemorySessionRepository(policy, clock);
  const limiter = new InMemoryAttemptLimiter(clock);
  const securityLog = new RecordingSecurityLog();
  const sessionOpener = new SessionOpener(sessions, signer);
  return {
    clock,
    policy,
    accounts,
    hasher,
    signer,
    sessions,
    limiter,
    securityLog,
    sessionOpener,
  };
}

export type AuthTestHarness = ReturnType<typeof createAuthTestHarness>;
