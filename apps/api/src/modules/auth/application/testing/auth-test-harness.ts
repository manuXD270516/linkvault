import { RefreshSessionPolicy } from '../../domain/refresh-session';
import type { ApiConfig } from '../../../../infrastructure/config/api-config.schema';
import { CapturingMailer } from '../../../../infrastructure/mail/capturing-mailer';
import { AuthEmailSender } from '../auth-email-sender';
import { SessionOpener } from '../issued-session';
import { InMemoryAttemptLimiter } from './in-memory-attempt-limiter';
import { InMemoryEmailTokenRepository } from './in-memory-email-token.repository';
import {
  FakeAccessTokenSigner,
  FakePasswordHasher,
  InMemorySessionRepository,
  InMemoryUserAccounts,
  MovableClock,
  RecordingSecurityLog,
} from './auth-test-doubles';

const TEST_MAIL_CONFIG = {
  WEB_BASE_URL: 'http://localhost:4200',
  AUTH_VERIFY_TOKEN_TTL_HOURS: 24,
  AUTH_RESET_TOKEN_TTL_SECONDS: 3600,
} as Pick<
  ApiConfig,
  'WEB_BASE_URL' | 'AUTH_VERIFY_TOKEN_TTL_HOURS' | 'AUTH_RESET_TOKEN_TTL_SECONDS'
>;

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
  const emailTokens = new InMemoryEmailTokenRepository(clock);
  const mailer = new CapturingMailer();
  const emailSender = new AuthEmailSender(
    emailTokens,
    mailer,
    clock,
    TEST_MAIL_CONFIG as ApiConfig,
  );
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
    emailTokens,
    mailer,
    emailSender,
  };
}

export type AuthTestHarness = ReturnType<typeof createAuthTestHarness>;
