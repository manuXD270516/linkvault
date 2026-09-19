import { type AiConfig, AiModule } from '@linkvault/ai';
import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import { AppConfigModule } from '../infrastructure/config/app-config.module';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { OutboxRelayModule } from '../infrastructure/outbox/outbox-relay.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { ApplicationsModule } from '../modules/applications/presentation/applications.module';
import { AuthModule } from '../modules/auth/presentation/auth.module';
import { GroupsModule } from '../modules/groups/presentation/groups.module';
import { LinksModule } from '../modules/links/presentation/links.module';
import { UsersModule } from '../modules/users/presentation/users.module';
import { EventsModule } from '../presentation/http/events.module';
import { HealthModule } from '../presentation/http/health.module';

@Module({})
export class AppModule {
  /**
   * El relay del outbox se importa solo si está encendido (D6 de job-links): es lo que crea la cola de BullMQ, y con
   * `OUTBOX_RELAY_ENABLED=false` no debe existir ninguna `Queue` ni conexión a Redis por esa vía.
   *
   * `ai` es la configuración de IA ya validada por `parseAiConfig` en `loadApiConfigOrExit` (D1 de
   * paste-job-description): `api` lee el texto pegado dentro de la petición. `AiModule` usa la conexión Mongoose por
   * defecto que registra `MongoPersistenceModule`, y solo abre Redis si la cadena usa la caché real: con `mock`, que es
   * lo que usan los tests, no abre ninguna conexión nueva.
   */
  static register(config: ApiConfig, ai: AiConfig): DynamicModule {
    // Se construye una sola vez y se le pasa a `LinksModule`, como hace el worker: `RUN_TASK` lo exporta `AiModule`, y
    // lo que un módulo importa no llega a sus hermanos. Es el mismo objeto, así que Nest lo instancia una vez.
    const aiModule = AiModule.forRootAsync({
      useFactory: () => ({ config: ai, redisUrl: config.REDIS_URL }),
    });
    // Igual con `LinksModule`: `ApplicationsModule` recibe este mismo objeto para usar `LinksFacade`. Importar la clase a
    // secas crearía una segunda instancia de `LinksModule` sin `RUN_TASK` (D1 de applications-tracking).
    const linksModule = LinksModule.register(aiModule);

    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MongoPersistenceModule,
        RedisHealthModule,
        HealthModule,
        EventsModule,
        UsersModule,
        AuthModule,
        GroupsModule,
        aiModule,
        linksModule,
        ApplicationsModule.register(linksModule),
        ...(config.OUTBOX_RELAY_ENABLED ? [OutboxRelayModule] : []),
      ],
    };
  }
}
