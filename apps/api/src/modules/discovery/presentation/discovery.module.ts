import { Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import { LimitsModule } from '../../../infrastructure/limits/limits.module';
import { REDIS_APP_CLIENT } from '../../../infrastructure/redis/redis-app-client';
import { RedisAppModule } from '../../../infrastructure/redis/redis-app.module';
import { UsersModule } from '../../users/presentation/users.module';
import { DISCOVERY_BOARD_ADAPTERS } from '../application/ports/discovery-board-adapters.port';
import { DISCOVERY_LIMITER } from '../application/ports/discovery-limiter.port';
import { DISCOVERY_USER_LANGUAGE } from '../application/ports/discovery-user-language.port';
import { SearchDiscovery } from '../application/search-discovery.usecase';
import type { DiscoveryBoardAdapter } from '../domain/discovery-board';
import { GetonboardDiscoveryAdapter } from '../infrastructure/adapters/getonboard-discovery.adapter';
import { mockDiscoveryAdapters } from '../infrastructure/adapters/mock-discovery.adapter';
import { RemoteokDiscoveryAdapter } from '../infrastructure/adapters/remoteok-discovery.adapter';
import { CounterDiscoveryLimiter } from '../infrastructure/counter-discovery-limiter';
import { CounterRemoteokEgressLimiter } from '../infrastructure/counter-remoteok-egress-limiter';
import { UsersFacadeDiscoveryLanguage } from '../infrastructure/users-facade-discovery-language';
import { DiscoveryController } from './discovery.controller';

/** UA identificable para adapters live (alineado con enrichment). */
export const DISCOVERY_USER_AGENT =
  'LinkVaultBot/0.1 (+https://github.com/manuXD270516/linkvault)';

/**
 * Módulo discovery (ADR-043): búsqueda en bolsas públicas + mock CI.
 */
@Module({
  imports: [LimitsModule, RedisAppModule, UsersModule],
  controllers: [DiscoveryController],
  providers: [
    {
      provide: DISCOVERY_LIMITER,
      useClass: CounterDiscoveryLimiter,
    },
    {
      provide: DISCOVERY_USER_LANGUAGE,
      useClass: UsersFacadeDiscoveryLanguage,
    },
    {
      provide: DISCOVERY_BOARD_ADAPTERS,
      inject: [APP_CONFIG, REDIS_APP_CLIENT, FIXED_WINDOW_COUNTER],
      useFactory: (
        config: ApiConfig,
        redis: Redis,
        counter: FixedWindowCounter,
      ): readonly DiscoveryBoardAdapter[] => {
        if (config.DISCOVERY_CHAIN === 'mock') {
          return mockDiscoveryAdapters();
        }
        const httpFetch = globalThis.fetch.bind(globalThis);
        return [
          new GetonboardDiscoveryAdapter({
            httpFetch,
            userAgent: DISCOVERY_USER_AGENT,
          }),
          new RemoteokDiscoveryAdapter({
            httpFetch,
            userAgent: DISCOVERY_USER_AGENT,
            redis,
            egress: new CounterRemoteokEgressLimiter(counter),
          }),
        ];
      },
    },
    SearchDiscovery,
  ],
})
export class DiscoveryModule {}
