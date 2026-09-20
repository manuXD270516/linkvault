import type { Application as ApplicationResponse } from '@linkvault/shared';
import type { Application } from '../domain/application.entity';
import {
  ApplicationFitScores,
  type LinkFitScore,
} from './application-fit-scores';
import { toApplicationResponse } from './application.mapper';
import type { ApplicationLinks } from './ports/application-links.port';

/**
 * Respuesta de una sola postulación, con la ficha de su link y la puntuación derivada en una consulta por lote. Un
 * `JobLink` nunca se borra (ADR-021), así que una ficha que falta es un invariante roto y sale como error interno.
 */
export async function respondWithCard(
  links: ApplicationLinks,
  fitScores: ApplicationFitScores,
  application: Application,
): Promise<ApplicationResponse> {
  const [card] = await links.cardsOf([application.linkId]);
  if (card === undefined) {
    throw new Error('The link of an application has no card');
  }
  const scores = await fitScores.scoresFor(application.userId, [
    application.linkId,
  ]);
  const fit: LinkFitScore | undefined = scores.get(application.linkId);
  return toApplicationResponse(application, card, fit);
}
