import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { OutboxRelayModule } from '../infrastructure/outbox/outbox-relay.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { AuthModule } from '../modules/auth/presentation/auth.module';
import { GroupsModule } from '../modules/groups/presentation/groups.module';
import { LinksModule } from '../modules/links/presentation/links.module';
import { UsersModule } from '../modules/users/presentation/users.module';
import { HealthModule } from '../presentation/http/health.module';

@Module({})
export class AppModule {
  /**
   * El relay del outbox se importa solo si está encendido (D6 de job-links): es lo que crea la cola de BullMQ, y con
   * `OUTBOX_RELAY_ENABLED=false` no debe existir ninguna `Queue` ni conexión a Redis por esa vía.
   */
  static register(config: ApiConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MongoPersistenceModule,
        RedisHealthModule,
        HealthModule,
        UsersModule,
        AuthModule,
        GroupsModule,
        LinksModule,
        ...(config.OUTBOX_RELAY_ENABLED ? [OutboxRelayModule] : []),
      ],
    };
  }
}
