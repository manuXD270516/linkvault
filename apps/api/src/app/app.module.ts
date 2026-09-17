import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { AuthModule } from '../modules/auth/presentation/auth.module';
import { GroupsModule } from '../modules/groups/presentation/groups.module';
import { UsersModule } from '../modules/users/presentation/users.module';
import { HealthModule } from '../presentation/http/health.module';

@Module({})
export class AppModule {
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
      ],
    };
  }
}
