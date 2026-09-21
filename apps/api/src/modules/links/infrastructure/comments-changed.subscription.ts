import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { DeliverCommentsChanged } from '../application/deliver-comments-changed.usecase';
import {
  COMMENT_NOTICES,
  type CommentNotices,
} from '../application/ports/comment-notices.port';

/**
 * La **única** suscripción de este proceso al canal de avisos de comentarios (D9 de group-comments), gemela de
 * `LinkEnrichedSubscription`. Suscribirse no puede tumbar el arranque: sin Redis, `api` sigue sirviendo peticiones y lo
 * único que se pierde es que una pantalla abierta se entere sola.
 */
@Injectable()
export class CommentsChangedSubscription
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(CommentsChangedSubscription.name);
  private unsubscribe: (() => Promise<void>) | undefined;

  constructor(
    @Inject(COMMENT_NOTICES) private readonly notices: CommentNotices,
    private readonly deliver: DeliverCommentsChanged,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.notices.subscribe((payload) =>
        this.deliver.execute(payload).then(() => undefined),
      );
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not subscribe to comment notices (${name}); open screens will not update on their own`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe !== undefined) {
      // No await: con Redis en hang, `UNSUBSCRIBE` no contesta y tumbaría el cierre (health-contract).
      void unsubscribe().catch(() => undefined);
    }
  }
}
