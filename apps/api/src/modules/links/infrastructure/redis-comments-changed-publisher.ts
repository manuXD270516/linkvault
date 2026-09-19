import {
  GROUP_LINK_COMMENTS_CHANNEL,
  groupLinkCommentsChangedEvent,
  type GroupLinkCommentsChangedPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { CommentsChangedPublisher } from '../application/ports/comments-changed-publisher.port';

// Adaptador COMMENTS_CHANGED_PUBLISHER sobre el canal de Redis `events:group-link.comments` (D9 de group-comments).
// Publica `GroupLinkCommentsChanged.v1` con el cliente de aplicación (`REDIS_APP_CLIENT`), que no encola comandos sin
// conexión: con Redis caído, publicar falla enseguida. El fallo se registra una vez por racha, sin el cuerpo del aviso,
// y nunca se propaga: el comentario ya está guardado.
//
// El aviso solo lleva identificadores y el tipo de cambio: ni texto ni autor. El canal no sabe quién puede ver qué.

/** Lo que el adaptador necesita de Redis; un `Redis` de ioredis lo cumple, y un doble de test también. */
export interface CommentsPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Lo que el adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface CommentsPublisherLogger {
  warn(message: string): void;
}

export class RedisCommentsChangedPublisher implements CommentsChangedPublisher {
  private reported = false;

  constructor(
    private readonly client: CommentsPublisherClient,
    private readonly logger: CommentsPublisherLogger = new Logger(
      RedisCommentsChangedPublisher.name,
    ),
  ) {}

  async publish(payload: GroupLinkCommentsChangedPayload): Promise<void> {
    try {
      await this.client.publish(
        GROUP_LINK_COMMENTS_CHANNEL,
        JSON.stringify(
          groupLinkCommentsChangedEvent({
            // Solo estos cuatro campos, aunque quien llame pase más: el canal nunca lleva texto ni autor.
            groupId: payload.groupId,
            linkId: payload.linkId,
            commentId: payload.commentId,
            change: payload.change,
          }),
        ),
      );
      // Vuelve a haber canal: la próxima racha de fallos sí merece su renglón.
      this.reported = false;
    } catch (error: unknown) {
      this.report(error);
    }
  }

  /** Un aviso por racha, con el nombre del error y sin su mensaje ni el del aviso. */
  private report(error: unknown): void {
    if (this.reported) return;
    this.reported = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Could not announce a comment change (${name}); open screens will not update on their own`,
    );
  }
}
