import type { GroupLinkCommentsChangedPayload } from '@linkvault/shared';

// Puerto del canal por el que llegan los avisos de comentarios (D9 de group-comments), gemelo de ENRICHMENT_NOTICES.
// Solo tipos y el token; el adaptador va sobre el cliente suscriptor de Redis que comparte el proceso.

export const COMMENT_NOTICES = Symbol('COMMENT_NOTICES');

export interface CommentNotices {
  /**
   * Escucha los avisos, una vez por proceso. Devuelve cómo dejar de escuchar. Un aviso que no cumple su contrato se
   * descarta sin registrar su contenido.
   */
  subscribe(
    handler: (payload: GroupLinkCommentsChangedPayload) => Promise<void>,
  ): Promise<() => Promise<void>>;
}
