import type { ApplicationListResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationFitScores } from './application-fit-scores';
import { toApplicationResponse } from './application.mapper';
import {
  APPLICATION_LINKS,
  type ApplicationLinks,
} from './ports/application-links.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';

/**
 * `GET /api/applications` (spec applications/tracking, "Mis postulaciones"): las postulaciones propias, de la cambiada
 * más recientemente a la más antigua, con la ficha de su link y la puntuación derivada por lote. Las fichas llegan en
 * **una sola llamada** a `cardsOf`, sin contexto de grupo: una postulación sigue apareciendo aunque su dueño ya no vea
 * el link (ADR-024 §5). Con `linkIds`, solo las de esos links.
 *
 * Una postulación cuya ficha faltara (un `JobLink` nunca se borra, así que no debería pasar) se omite del listado en vez
 * de romper el tablero entero.
 */
@Injectable()
export class ListMyApplications {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    private readonly fitScores: ApplicationFitScores,
  ) {}

  async execute(
    userId: string,
    linkIds?: readonly string[],
  ): Promise<ApplicationListResponse> {
    const applications = await this.applications.listByUser(userId, linkIds);
    if (applications.length === 0) {
      return { items: [] };
    }
    const applicationLinkIds = applications.map(
      (application) => application.linkId,
    );
    const [cardsList, scores] = await Promise.all([
      this.links.cardsOf(applicationLinkIds),
      this.fitScores.scoresFor(userId, applicationLinkIds),
    ]);
    const cards = new Map(cardsList.map((card) => [card.id, card]));
    return {
      items: applications.flatMap((application) => {
        const card = cards.get(application.linkId);
        return card === undefined
          ? []
          : [
              toApplicationResponse(
                application,
                card,
                scores.get(application.linkId),
              ),
            ];
      }),
    };
  }
}
