import type { GroupLinkCommentsChangedPayload } from '@linkvault/shared';

// Puerto de publicación del aviso de comentarios (D9 de group-comments). Se publica en un canal de Redis que reciben
// todas las instancias de `api`, incluida esta, y lo reparte `DeliverCommentsChanged`. El aviso solo lleva
// identificadores y el tipo de cambio: nunca el texto ni el autor. Solo tipos y el token.

export const COMMENTS_CHANGED_PUBLISHER = Symbol('COMMENTS_CHANGED_PUBLISHER');

export interface CommentsChangedPublisher {
  /**
   * Publica el aviso. **Nunca lanza**: cuando se llama, la escritura ya está confirmada, y un Redis caído solo significa
   * que una pantalla abierta no se entera sola. Quien llama no espera a que termine (`void`).
   */
  publish(payload: GroupLinkCommentsChangedPayload): Promise<void>;
}
