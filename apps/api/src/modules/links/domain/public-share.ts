import type { GroupRole } from '@linkvault/shared';

// Enlace público de un link compartido en un grupo (D1 y D2 de public-preview-share, ADR-027 §1 y §2). Vive en la
// **relación** link-grupo y no en la vacante: el permiso de "quien compartió o el propietario" solo existe sobre una
// relación, y un `JobLink` no tiene dueño.
//
// El slug se **quema** al despublicar: quien tuviera esa URL recibe `404` para siempre, y volver a publicar genera uno
// nuevo. Conservarlo devolvería el acceso a un tercero al que el dueño se lo había quitado.

/** Enlace público vivo de una relación. `publishedBy` NO sale nunca en una respuesta: es solo trazabilidad interna. */
export interface PublicShare {
  readonly slug: string;
  readonly publishedBy: string;
  readonly publishedAt: Date;
}

/**
 * Enciende y apaga el interruptor quien compartió el link o el `owner` del grupo, igual que la nota y los comentarios
 * (ADR-026 §3). Se juzga **antes** de mirar si el link estaba publicado, para que la respuesta no le revele su estado a
 * quien no puede tocarlo.
 */
export function mayPublish(
  requesterId: string,
  sharedBy: string,
  role: GroupRole,
): boolean {
  return requesterId === sharedBy || role === 'owner';
}

/** Intentos del repositorio ante una colisión del índice único del slug antes de rendirse (D2). */
export const MAX_PUBLIC_SLUG_ATTEMPTS = 5;

/**
 * Ningún intento dio un slug libre. NO es un error de dominio (no tiene código de la API): el filtro lo trata como
 * cualquier error inesperado y responde 500. Con 59 bits, cinco colisiones seguidas señalan una avería, y un `500` con
 * su log es mejor que una colisión silenciosa.
 */
export class PublicSlugExhausted extends Error {
  override readonly name = 'PublicSlugExhausted';

  constructor() {
    super(`No free public slug after ${MAX_PUBLIC_SLUG_ATTEMPTS} attempts`);
  }
}
