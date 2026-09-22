import { type AiConfig, AiModule } from '@linkvault/ai';
import { type DynamicModule, Module } from '@nestjs/common';
import type { ApiConfig } from '../infrastructure/config/api-config.schema';
import {
  APP_CONFIG,
  AppConfigModule,
} from '../infrastructure/config/app-config.module';
import { AppLoggerModule } from '../infrastructure/logging/app-logger.module';
import { MailModule } from '../infrastructure/mail/mail.module';
import { OutboxRelayModule } from '../infrastructure/outbox/outbox-relay.module';
import { MongoPersistenceModule } from '../infrastructure/persistence/mongo-persistence.module';
import { RedisHealthModule } from '../infrastructure/redis/redis-health.module';
import { ApplicationsModule } from '../modules/applications/presentation/applications.module';
import { AuthModule } from '../modules/auth/presentation/auth.module';
import { CvModule } from '../modules/cv/presentation/cv.module';
import { GroupsModule } from '../modules/groups/presentation/groups.module';
import { LinksModule } from '../modules/links/presentation/links.module';
import { MatchModule } from '../modules/match/presentation/match.module';
import { NotificationsModule } from '../modules/notifications/presentation/notifications.module';
import { SearchModule } from '../modules/search/presentation/search.module';
import { DeleteAccount } from '../modules/users/application/delete-account.usecase';
import { ACCOUNT_DELETION_CASCADE } from '../modules/users/application/ports/account-deletion-cascade.port';
import { CV_USER_PREFIX_DELETER } from '../modules/users/application/ports/cv-user-prefix-deleter.port';
import { MongoAccountDeletionCascade } from '../modules/users/infrastructure/mongo-account-deletion.cascade';
import {
  createS3CvPrefixStore,
  S3CvUserPrefixDeleter,
} from '../modules/users/infrastructure/s3-cv-user-prefix.deleter';
import { AccountDeletionController } from '../modules/users/presentation/account-deletion.controller';
import { AiKeysModule } from '../modules/users/presentation/ai-keys.module';
import { UsersModule } from '../modules/users/presentation/users.module';
import { EventsModule } from '../presentation/http/events.module';
import { HealthModule } from '../presentation/http/health.module';
import { MetricsModule } from '../presentation/http/metrics.module';

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
   *
   * El borrado de cuenta se cablea aquí (no en un módulo que reimporte `GroupsModule`): Nest registraría dos veces las
   * rutas de `/api/groups` si otro DynamicModule volviera a importar `GroupsModule` junto al de `AppModule`.
   */
  static register(config: ApiConfig, ai: AiConfig): DynamicModule {
    // Se construye una sola vez y se le pasa a `LinksModule`, como hace el worker: `RUN_TASK` lo exporta `AiModule`, y
    // lo que un módulo importa no llega a sus hermanos. Es el mismo objeto, así que Nest lo instancia una vez.
    const aiModule = AiModule.forRootAsync({
      useFactory: () => ({ config: ai, redisUrl: config.REDIS_URL }),
    });
    const searchModule = SearchModule.register();
    // Igual con `LinksModule`: `ApplicationsModule` y `MatchModule` reciben este mismo objeto para usar `LinksFacade`.
    // Importar la clase a secas crearía una segunda instancia de `LinksModule` sin `RUN_TASK` (D1 de
    // applications-tracking).
    const linksModule = LinksModule.register(aiModule, searchModule);
    // `MatchModule` registra el lector de puntuaciones en `ApplicationFitScores`: mismo objeto DynamicModule para no
    // duplicar el módulo de postulaciones.
    const applicationsModule = ApplicationsModule.register(
      linksModule,
      searchModule,
    );

    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        AppLoggerModule,
        MailModule,
        MongoPersistenceModule,
        RedisHealthModule,
        HealthModule,
        MetricsModule,
        EventsModule,
        UsersModule,
        AiKeysModule.register(aiModule),
        AuthModule,
        GroupsModule,
        aiModule,
        searchModule,
        linksModule,
        applicationsModule,
        NotificationsModule,
        CvModule.register(searchModule),
        MatchModule.register(linksModule, aiModule, applicationsModule),
        ...(config.OUTBOX_RELAY_ENABLED ? [OutboxRelayModule] : []),
      ],
      controllers: [AccountDeletionController],
      providers: [
        {
          provide: CV_USER_PREFIX_DELETER,
          inject: [APP_CONFIG],
          useFactory: (apiConfig: ApiConfig) =>
            new S3CvUserPrefixDeleter(
              createS3CvPrefixStore({
                endpoint: apiConfig.S3_ENDPOINT,
                region: apiConfig.S3_REGION,
                accessKey: apiConfig.S3_ACCESS_KEY,
                secretKey: apiConfig.S3_SECRET_KEY,
                bucket: apiConfig.S3_BUCKET,
              }),
            ),
        },
        {
          provide: ACCOUNT_DELETION_CASCADE,
          useClass: MongoAccountDeletionCascade,
        },
        DeleteAccount,
      ],
    };
  }
}
