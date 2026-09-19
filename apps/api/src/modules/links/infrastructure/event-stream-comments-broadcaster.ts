import {
  GROUP_LINK_COMMENTS_EVENT_NAME,
  type GroupLinkCommentsMessage,
} from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { EventStreamRegistry } from '../../../infrastructure/realtime/event-stream.registry';
import type { CommentsBroadcaster } from '../application/ports/comments-broadcaster.port';

/**
 * Adaptador COMMENTS_BROADCASTER sobre el registro de conexiones del canal de eventos (D9 de group-comments). El nombre
 * del evento y la forma del cuerpo son del contrato de `libs/shared`, para que el SPA no tenga que adivinarlos.
 */
@Injectable()
export class EventStreamCommentsBroadcaster implements CommentsBroadcaster {
  constructor(private readonly streams: EventStreamRegistry) {}

  hasListeners(): boolean {
    return this.streams.hasListeners;
  }

  send(userId: string, message: GroupLinkCommentsMessage): number {
    return this.streams.publish(
      userId,
      GROUP_LINK_COMMENTS_EVENT_NAME,
      JSON.stringify(message),
    );
  }
}
