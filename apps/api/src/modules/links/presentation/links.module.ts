import { Module, type OnModuleInit } from '@nestjs/common';
import { LimitsModule } from '../../../infrastructure/limits/limits.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { RealtimeModule } from '../../../infrastructure/realtime/realtime.module';
import {
  createRedisSubscriberClient,
  REDIS_SUBSCRIBER_CLIENT,
  RedisSubscriberConnection,
} from '../../../infrastructure/redis/redis-subscriber-client';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { GroupDeletionHooks } from '../../groups/application/group-deletion-hooks';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { UsersModule } from '../../users/presentation/users.module';
import { BackfillEnrichment } from '../application/backfill-enrichment.usecase';
import { DeliverLinkEnriched } from '../application/deliver-link-enriched.usecase';
import { ImportLinks } from '../application/import-links.usecase';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { LINKS_CLOCK } from '../application/ports/clock.port';
import { ENRICHMENT_BROADCASTER } from '../application/ports/enrichment-broadcaster.port';
import { ENRICHMENT_NOTICES } from '../application/ports/enrichment-notices.port';
import { GROUP_LINK_REPOSITORY } from '../application/ports/group-link-repository.port';
import { GROUP_MEMBERSHIP } from '../application/ports/group-membership.port';
import { JOB_LINK_REPOSITORY } from '../application/ports/job-link-repository.port';
import { LINK_LIMITER } from '../application/ports/link-limiter.port';
import { LINK_USER_DIRECTORY } from '../application/ports/link-user-directory.port';
import { USER_LINK_REPOSITORY } from '../application/ports/user-link-repository.port';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { RequestLinkEnrichment } from '../application/request-link-enrichment.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { UpdateLinkPreview } from '../application/update-link-preview.usecase';
import { GroupLinksDeletionHook } from '../infrastructure/group-links-deletion.hook';
import { CounterLinkLimiter } from '../infrastructure/counter-link-limiter';
import { EventStreamBroadcaster } from '../infrastructure/event-stream-broadcaster';
import { LinkEnrichedSubscription } from '../infrastructure/link-enriched.subscription';
import {
  RedisEnrichmentNotices,
  type RedisSubscriber,
} from '../infrastructure/redis-enrichment-notices';
import { GroupsFacadeMembership } from '../infrastructure/groups-facade-membership';
import { MongoGroupLinkRepository } from '../infrastructure/mongo-group-link.repository';
import { MongoJobLinkRepository } from '../infrastructure/mongo-job-link.repository';
import { MongoUserLinkRepository } from '../infrastructure/mongo-user-link.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeLinkDirectory } from '../infrastructure/users-facade-link-directory';
import { GroupLinksController } from './group-links.controller';
import { LinksController } from './links.controller';

/**
 * Módulo `links` (D1 de job-links). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que
 * quien lo importa debe registrar `MongooseModule.forRoot*`.
 *
 * Importa `GroupsModule` para la pertenencia y el rol (`GroupsFacade`), `UsersModule` para los nombres visibles de quien
 * compartió (`UsersFacade`), `OutboxModule` para escribir el evento dentro de la transacción del alta y `LimitsModule`
 * para contar importaciones y relecturas: la dependencia va siempre de `links` a los demás, que es la dirección
 * permitida. No exporta nada: todavía nadie entra a `links`.
 *
 * NO monta ninguna `Queue`: reintentar y reencolar van por el outbox (D10 de link-enrichment), así que la suite de
 * integración de `api` sigue sin necesitar Redis para escribir en la cola.
 *
 * Sí abre una conexión de Redis en **modo suscripción** para los avisos de enriquecimiento, una sola por proceso (D9).
 * Si Redis no está, la suscripción avisa una vez y `api` sigue sirviendo peticiones: lo único que se pierde es que una
 * pantalla abierta se entere sola, y se recupera sola cuando Redis vuelve.
 *
 * Al arrancar registra su limpieza en `GroupDeletionHooks`, para que borrar un grupo se lleve sus `GroupLink` dentro de
 * la misma transacción y no deje relaciones huérfanas (D7b). `groups` sigue sin conocer a `links`.
 */
@Module({
  imports: [
    GroupsModule,
    UsersModule,
    OutboxModule,
    LimitsModule,
    RealtimeModule,
  ],
  controllers: [LinksController, GroupLinksController],
  providers: [
    { provide: JOB_LINK_REPOSITORY, useClass: MongoJobLinkRepository },
    { provide: GROUP_LINK_REPOSITORY, useClass: MongoGroupLinkRepository },
    { provide: USER_LINK_REPOSITORY, useClass: MongoUserLinkRepository },
    { provide: GROUP_MEMBERSHIP, useClass: GroupsFacadeMembership },
    { provide: LINK_USER_DIRECTORY, useClass: UsersFacadeLinkDirectory },
    { provide: LINK_LIMITER, useClass: CounterLinkLimiter },
    { provide: ENRICHMENT_BROADCASTER, useClass: EventStreamBroadcaster },
    {
      // Conexión propia: un cliente de Redis en modo suscripción no acepta comandos, así que no puede ser el mismo que
      // cuenta intentos. Y tampoco puede ser un cliente **de aplicación**: ese no encola comandos sin conexión, así que
      // el `SUBSCRIBE` del arranque se rechazaba antes de que existiera el socket y el canal quedaba muerto en cualquier
      // ejecución real. `createRedisSubscriberClient` es la configuración de un suscriptor y `RedisEnrichmentNotices`
      // conecta antes de pedir el canal; aquí solo se cablea.
      provide: REDIS_SUBSCRIBER_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) =>
        createRedisSubscriberClient(config.REDIS_URL),
    },
    {
      provide: ENRICHMENT_NOTICES,
      inject: [REDIS_SUBSCRIBER_CLIENT],
      useFactory: (client: RedisSubscriber) =>
        new RedisEnrichmentNotices(client),
    },
    // Abrir la conexión es de quien se suscribe; cerrarla al apagar, de esto.
    RedisSubscriberConnection,
    { provide: LINKS_CLOCK, useClass: SystemClock },
    SaveLink,
    ImportLinks,
    ListGroupLinks,
    ListMyLinks,
    RemoveGroupLink,
    RemoveMyLink,
    UpdateLinkPreview,
    RequestLinkEnrichment,
    DeliverLinkEnriched,
    LinkEnrichedSubscription,
    BackfillEnrichment,
    GroupLinksDeletionHook,
  ],
})
export class LinksModule implements OnModuleInit {
  constructor(
    private readonly deletionHooks: GroupDeletionHooks,
    private readonly groupLinksDeletion: GroupLinksDeletionHook,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register(this.groupLinksDeletion);
  }
}
