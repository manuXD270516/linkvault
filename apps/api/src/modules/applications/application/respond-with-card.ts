import type { Application as ApplicationResponse } from '@linkvault/shared';
import type { Application } from '../domain/application.entity';
import { toApplicationResponse } from './application.mapper';
import type { ApplicationLinks } from './ports/application-links.port';

/**
 * Respuesta de una sola postulación, con la ficha de su link en una consulta. Un `JobLink` nunca se borra (ADR-021:
 * quitar un link es de la relación, no de la vacante), así que una ficha que falta es un invariante roto y sale como
 * error interno, nunca como una respuesta sin ficha.
 */
export async function respondWithCard(
  links: ApplicationLinks,
  application: Application,
): Promise<ApplicationResponse> {
  const [card] = await links.cardsOf([application.linkId]);
  if (card === undefined) {
    throw new Error('The link of an application has no card');
  }
  return toApplicationResponse(application, card);
}
