import type { GroupLinkCommentsMessage } from '@linkvault/shared';

// Puerto de salida hacia el navegador de los avisos de comentarios (D9 de group-comments, critic 7 de la iteración 2).
// `links` decide **a quién** (los miembros actuales del grupo) y **qué** (el resumen ya actualizado); cómo llega a una
// pestaña abierta es del canal de eventos, que es plataforma.

export const COMMENTS_BROADCASTER = Symbol('COMMENTS_BROADCASTER');

export interface CommentsBroadcaster {
  /** `true` si hay alguna conexión abierta en este proceso. Sin ninguna, el aviso se descarta sin leer nada. */
  hasListeners(): boolean;
  /** Envía el mensaje a las conexiones abiertas de esa persona y dice a cuántas llegó. */
  send(userId: string, message: GroupLinkCommentsMessage): number;
}
