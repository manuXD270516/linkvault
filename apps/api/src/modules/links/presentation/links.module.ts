import { RUN_TASK, type RunTaskFn } from '@linkvault/ai';
import type { Redis } from 'ioredis';
import { type DynamicModule, Module, type OnModuleInit } from '@nestjs/common';
import { LimitsModule } from '../../../infrastructure/limits/limits.module';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { RealtimeModule } from '../../../infrastructure/realtime/realtime.module';
import { REDIS_APP_CLIENT } from '../../../infrastructure/redis/redis-app-client';
import { RedisAppModule } from '../../../infrastructure/redis/redis-app.module';
import {
  createRedisSubscriberClient,
  REDIS_SUBSCRIBER_CLIENT,
  RedisSubscriberConnection,
} from '../../../infrastructure/redis/redis-subscriber-client';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import { PublicRouteLogger } from '../../../infrastructure/logging/public-route-logger';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { GroupDeletionHooks } from '../../groups/application/group-deletion-hooks';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { UsersModule } from '../../users/presentation/users.module';
import { BackfillEnrichment } from '../application/backfill-enrichment.usecase';
import { DeleteGroupLinkComment } from '../application/delete-group-link-comment.usecase';
import { DeliverCommentsChanged } from '../application/deliver-comments-changed.usecase';
import { DeliverLinkEnriched } from '../application/deliver-link-enriched.usecase';
import { GetPublicPreview } from '../application/get-public-preview.usecase';
import { ImportLinks } from '../application/import-links.usecase';
import { ListGroupLinkComments } from '../application/list-group-link-comments.usecase';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { LinksFacade } from '../application/links.facade';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { LINKS_CLOCK } from '../application/ports/clock.port';
import { COMMENT_NOTICES } from '../application/ports/comment-notices.port';
import { COMMENTS_BROADCASTER } from '../application/ports/comments-broadcaster.port';
import { COMMENTS_CHANGED_PUBLISHER } from '../application/ports/comments-changed-publisher.port';
import { ENRICHMENT_BROADCASTER } from '../application/ports/enrichment-broadcaster.port';
import { ENRICHMENT_NOTICES } from '../application/ports/enrichment-notices.port';
import { GROUP_LINK_COMMENT_REPOSITORY } from '../application/ports/group-link-comment-repository.port';
import { GROUP_LINK_REPOSITORY } from '../application/ports/group-link-repository.port';
import { GROUP_MEMBERSHIP } from '../application/ports/group-membership.port';
import { JOB_LINK_REPOSITORY } from '../application/ports/job-link-repository.port';
import { LINK_LIMITER } from '../application/ports/link-limiter.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from '../application/ports/link-user-directory.port';
import { PASTED_EXTRACTION } from '../application/ports/pasted-extraction.port';
import { PUBLIC_SLUG_GENERATOR } from '../application/ports/public-slug-generator.port';
import { PUBLIC_URLS } from '../application/ports/public-urls.port';
import { LINK_ENRICHED_PUBLISHER } from '../application/ports/link-enriched-publisher.port';
import { PasteDescription } from '../application/paste-description.usecase';
import { PostGroupLinkComment } from '../application/post-group-link-comment.usecase';
import { PublishGroupLink } from '../application/publish-group-link.usecase';
import { UnpublishGroupLink } from '../application/unpublish-group-link.usecase';
import { USER_LINK_REPOSITORY } from '../application/ports/user-link-repository.port';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { RemoveShareNote } from '../application/remove-share-note.usecase';
import { ReopenJobLink } from '../application/reopen-job-link.usecase';
import { RequestLinkEnrichment } from '../application/request-link-enrichment.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { SetKnowSomeone } from '../application/set-know-someone.usecase';
import { SetGroupLinkTags } from '../application/set-group-link-tags.usecase';
import { SetGroupLinkPinned } from '../application/set-group-link-pinned.usecase';
import { UpdateLinkPreview } from '../application/update-link-preview.usecase';
import { GroupLinksDeletionHook } from '../infrastructure/group-links-deletion.hook';
import { CommentsChangedSubscription } from '../infrastructure/comments-changed.subscription';
import { CounterLinkLimiter } from '../infrastructure/counter-link-limiter';
import { EventStreamCommentsBroadcaster } from '../infrastructure/event-stream-comments-broadcaster';
import { EventStreamBroadcaster } from '../infrastructure/event-stream-broadcaster';
import { LinkEnrichedSubscription } from '../infrastructure/link-enriched.subscription';
import {
  RedisEnrichmentNotices,
  type RedisSubscriber,
} from '../infrastructure/redis-enrichment-notices';
import { GroupsFacadeMembership } from '../infrastructure/groups-facade-membership';
import { MongoGroupLinkCommentRepository } from '../infrastructure/mongo-group-link-comment.repository';
import { MongoGroupLinkRepository } from '../infrastructure/mongo-group-link.repository';
import { MongoJobLinkRepository } from '../infrastructure/mongo-job-link.repository';
import { MongoUserLinkRepository } from '../infrastructure/mongo-user-link.repository';
import { ConfigPublicUrls } from '../infrastructure/config-public-urls';
import { RandomPublicSlugGenerator } from '../infrastructure/random-public-slug.generator';
import { RunTaskPastedExtraction } from '../infrastructure/run-task-pasted-extraction';
import { RedisCommentNotices } from '../infrastructure/redis-comment-notices';
import { RedisCommentsChangedPublisher } from '../infrastructure/redis-comments-changed-publisher';
import { RedisLinkEnrichedPublisher } from '../infrastructure/redis-link-enriched-publisher';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeLinkDirectory } from '../infrastructure/users-facade-link-directory';
import { GroupLinkCommentsController } from './group-link-comments.controller';
import { GroupLinksController } from './group-links.controller';
import { LinksController } from './links.controller';
import { PublicPageController } from './public-page.controller';
import { PublicPreviewsController } from './public-previews.controller';

/**
 * Módulo `links` (D1 de job-links). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que
 * quien lo importa debe registrar `MongooseModule.forRoot*`.
 *
 * Importa `GroupsModule` para la pertenencia y el rol (`GroupsFacade`), `UsersModule` para los nombres visibles de quien
 * compartió (`UsersFacade`), `OutboxModule` para escribir el evento dentro de la transacción del alta y `LimitsModule`
 * para contar importaciones y relecturas: la dependencia va siempre de `links` a los demás, que es la dirección
 * permitida. Exporta solo `LinksFacade`, la única entrada de otros módulos (D1 de applications-tracking), y quien la
 * use recibe **la misma instancia** del módulo que construye `AppModule` (`register(aiModule)`), nunca la clase a secas:
 * una segunda instancia no tendría `RUN_TASK` y la app no arrancaría. La IA le llega por `register(aiModule)`.
 *
 * NO monta ninguna `Queue`: reintentar y reencolar van por el outbox (D10 de link-enrichment), así que la suite de
 * integración de `api` sigue sin necesitar Redis para escribir en la cola.
 *
 * Sí abre una conexión de Redis en **modo suscripción** para los avisos de enriquecimiento, de comentarios y de
 * paso de análisis (`analysis.step`), una sola por proceso y compartida por los tres canales.
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
    RedisAppModule,
  ],
  controllers: [
    LinksController,
    GroupLinksController,
    GroupLinkCommentsController,
    // Fuera del prefijo `/api` (su `exclude` vive en `create-app`) y sin sesión, las dos.
    PublicPageController,
    PublicPreviewsController,
  ],
  providers: [
    { provide: JOB_LINK_REPOSITORY, useClass: MongoJobLinkRepository },
    { provide: GROUP_LINK_REPOSITORY, useClass: MongoGroupLinkRepository },
    {
      provide: GROUP_LINK_COMMENT_REPOSITORY,
      useClass: MongoGroupLinkCommentRepository,
    },
    { provide: USER_LINK_REPOSITORY, useClass: MongoUserLinkRepository },
    { provide: GROUP_MEMBERSHIP, useClass: GroupsFacadeMembership },
    { provide: LINK_USER_DIRECTORY, useClass: UsersFacadeLinkDirectory },
    { provide: LINK_LIMITER, useClass: CounterLinkLimiter },
    { provide: PUBLIC_SLUG_GENERATOR, useClass: RandomPublicSlugGenerator },
    {
      // Las dos URLs públicas salen de configuración, nunca de la cabecera `Host` de una petición (D5).
      provide: PUBLIC_URLS,
      inject: [APP_CONFIG],
      useFactory: (config: ApiConfig) =>
        new ConfigPublicUrls(config.PUBLIC_PAGE_BASE_URL, config.WEB_BASE_URL),
    },
    { provide: ENRICHMENT_BROADCASTER, useClass: EventStreamBroadcaster },
    { provide: COMMENTS_BROADCASTER, useClass: EventStreamCommentsBroadcaster },
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
    {
      // El **mismo** cliente suscriptor que los avisos de enriquecimiento y de `analysis.step`: una conexión en modo
      // suscripción por proceso, con los tres canales. Cada adaptador filtra los mensajes de su canal.
      provide: COMMENT_NOTICES,
      inject: [REDIS_SUBSCRIBER_CLIENT],
      useFactory: (client: RedisSubscriber) => new RedisCommentNotices(client),
    },
    // Abrir la conexión es de quien se suscribe; cerrarla al apagar, de esto.
    RedisSubscriberConnection,
    {
      // `RUN_TASK` llega del `AiModule` que `register` importa: sin él, este proveedor no se resuelve y la app no arranca.
      provide: PASTED_EXTRACTION,
      inject: [RUN_TASK, LINK_USER_DIRECTORY, APP_CONFIG],
      useFactory: (
        runTask: RunTaskFn,
        directory: LinkUserDirectory,
        config: ApiConfig,
      ) =>
        new RunTaskPastedExtraction(
          runTask,
          directory,
          config.PASTE_EXTRACTION_TIMEOUT_MS,
        ),
    },
    {
      // Publica en el canal de avisos con el cliente de aplicación, que solo manda comandos: el de suscripción no puede.
      provide: LINK_ENRICHED_PUBLISHER,
      inject: [REDIS_APP_CLIENT],
      useFactory: (client: Redis) => new RedisLinkEnrichedPublisher(client),
    },
    {
      // Aviso de comentarios con el cliente de aplicación: solo publica, sin texto ni autor (D9 de group-comments).
      provide: COMMENTS_CHANGED_PUBLISHER,
      inject: [REDIS_APP_CLIENT],
      useFactory: (client: Redis) => new RedisCommentsChangedPublisher(client),
    },
    { provide: LINKS_CLOCK, useClass: SystemClock },
    PublicRouteLogger,
    SaveLink,
    PasteDescription,
    ImportLinks,
    ListGroupLinks,
    ListMyLinks,
    RemoveGroupLink,
    RemoveMyLink,
    UpdateLinkPreview,
    ReopenJobLink,
    RequestLinkEnrichment,
    DeliverLinkEnriched,
    LinkEnrichedSubscription,
    PostGroupLinkComment,
    DeleteGroupLinkComment,
    ListGroupLinkComments,
    RemoveShareNote,
    PublishGroupLink,
    UnpublishGroupLink,
    SetKnowSomeone,
    SetGroupLinkTags,
    SetGroupLinkPinned,
    GetPublicPreview,
    DeliverCommentsChanged,
    CommentsChangedSubscription,
    BackfillEnrichment,
    GroupLinksDeletionHook,
    LinksFacade,
  ],
  exports: [LinksFacade, REDIS_SUBSCRIBER_CLIENT],
})
export class LinksModule implements OnModuleInit {
  /**
   * `LinksModule` con la IA (D1 de paste-job-description): el pegado lee el texto con `RUN_TASK`. `aiModule` es el mismo
   * objeto que importa `AppModule`, construido una vez: `AiModule` no es global y `RUN_TASK` solo es visible para quien
   * lo importa. Lo demás del módulo sigue en su decorador; Nest suma las dos partes.
   */
  static register(
    aiModule: DynamicModule,
    searchModule?: DynamicModule,
  ): DynamicModule {
    return {
      module: LinksModule,
      imports: [aiModule, ...(searchModule === undefined ? [] : [searchModule])],
    };
  }

  constructor(
    private readonly deletionHooks: GroupDeletionHooks,
    private readonly groupLinksDeletion: GroupLinksDeletionHook,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register(this.groupLinksDeletion);
  }
}
