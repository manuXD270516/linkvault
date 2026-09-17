import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { UsersModule } from '../../users/presentation/users.module';
import { ACCESS_TOKEN_SIGNER } from '../application/ports/access-token-signer.port';
import { CLOCK } from '../application/ports/clock.port';
import { USER_ACCOUNTS } from '../application/ports/user-accounts.port';
import type { Clock } from '../domain/clock';
import { JoseAccessTokenSigner } from '../infrastructure/jose-access-token-signer';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeUserAccounts } from '../infrastructure/users-facade-user-accounts';
import { AccessTokenGuard } from './access-token.guard';

/**
 * Módulo `auth` (D1 de auth-users). Por ahora solo cablea lo que necesita el guard global de access token; el limitador,
 * las sesiones, los use cases y el controlador llegan con la tarea 6.4 y siguientes. Necesita `AppConfigModule` (global) y
 * la conexión Mongoose por defecto que usa `UsersModule`.
 */
@Module({
  imports: [UsersModule],
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
    { provide: APP_GUARD, useClass: AccessTokenGuard },
  ],
})
export class AuthModule {}
