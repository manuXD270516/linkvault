import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import { LimitsModule } from '../../../infrastructure/limits/limits.module';
import { MailModule } from '../../../infrastructure/mail/mail.module';
import { UsersModule } from '../../users/presentation/users.module';
import { AuthEmailSender } from '../application/auth-email-sender';
import { ChangePassword } from '../application/change-password.usecase';
import { ForgotPassword } from '../application/forgot-password.usecase';
import { SessionOpener } from '../application/issued-session';
import { Login } from '../application/login.usecase';
import { Logout } from '../application/logout.usecase';
import { ACCESS_TOKEN_SIGNER } from '../application/ports/access-token-signer.port';
import { ATTEMPT_LIMITER } from '../application/ports/attempt-limiter.port';
import { AUTH_SECURITY_LOG } from '../application/ports/auth-security-log.port';
import { CLOCK } from '../application/ports/clock.port';
import { EMAIL_TOKEN_REPOSITORY } from '../application/ports/email-token-repository.port';
import { PASSWORD_HASHER } from '../application/ports/password-hasher.port';
import { SESSION_REPOSITORY } from '../application/ports/session-repository.port';
import { USER_ACCOUNTS } from '../application/ports/user-accounts.port';
import { RefreshSession } from '../application/refresh-session.usecase';
import { Register } from '../application/register.usecase';
import { ResendVerificationEmail } from '../application/resend-verification-email.usecase';
import { ResetPassword } from '../application/reset-password.usecase';
import { VerifyEmail } from '../application/verify-email.usecase';
import type { Clock } from '../domain/clock';
import { RefreshSessionPolicy } from '../domain/refresh-session';
import { Argon2PasswordHasher } from '../infrastructure/argon2-password-hasher';
import { JoseAccessTokenSigner } from '../infrastructure/jose-access-token-signer';
import { MongoEmailTokenRepository } from '../infrastructure/mongo-email-token.repository';
import { MongoSessionRepository } from '../infrastructure/mongo-session.repository';
import { NestAuthSecurityLog } from '../infrastructure/nest-auth-security-log';
import { RedisAttemptLimiter } from '../infrastructure/redis-attempt-limiter';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeUserAccounts } from '../infrastructure/users-facade-user-accounts';
import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';

/**
 * Módulo `auth` (D1 de auth-users + ADR-034): endpoints de `/api/auth`, use cases, adaptadores y el guard global.
 */
@Module({
  imports: [UsersModule, LimitsModule, MailModule],
  controllers: [AuthController],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: ACCESS_TOKEN_SIGNER,
      inject: [APP_CONFIG, CLOCK],
      useFactory: (config: ApiConfig, clock: Clock) =>
        new JoseAccessTokenSigner(
          {
            secret: config.AUTH_JWT_SECRET,
            ttlSeconds: config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
          },
          clock,
        ),
    },
    { provide: USER_ACCOUNTS, useClass: UsersFacadeUserAccounts },
    {
      provide: PASSWORD_HASHER,
      useFactory: () => new Argon2PasswordHasher(),
    },
    {
      provide: SESSION_REPOSITORY,
      inject: [getConnectionToken(), APP_CONFIG, CLOCK],
      useFactory: (connection: Connection, config: ApiConfig, clock: Clock) =>
        new MongoSessionRepository(
          connection,
          new RefreshSessionPolicy(clock, {
            refreshTtlDays: config.AUTH_REFRESH_TTL_DAYS,
            refreshMaxDays: config.AUTH_REFRESH_MAX_DAYS,
          }),
          clock,
        ),
    },
    {
      provide: EMAIL_TOKEN_REPOSITORY,
      inject: [getConnectionToken(), CLOCK],
      useFactory: (connection: Connection, clock: Clock) =>
        new MongoEmailTokenRepository(connection, clock),
    },
    {
      provide: ATTEMPT_LIMITER,
      inject: [FIXED_WINDOW_COUNTER, APP_CONFIG],
      useFactory: (counter: FixedWindowCounter, config: ApiConfig) =>
        new RedisAttemptLimiter(counter, { secret: config.AUTH_JWT_SECRET }),
    },
    { provide: AUTH_SECURITY_LOG, useFactory: () => new NestAuthSecurityLog() },
    SessionOpener,
    AuthEmailSender,
    Register,
    Login,
    RefreshSession,
    Logout,
    ChangePassword,
    ForgotPassword,
    ResetPassword,
    VerifyEmail,
    ResendVerificationEmail,
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
  exports: [EMAIL_TOKEN_REPOSITORY],
})
export class AuthModule {}
