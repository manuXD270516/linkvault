import type { TrackLinkRequest, TrackLinkResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { startTracking } from '../domain/application.entity';
import { TrackedLinkNotFound } from '../domain/errors';
import { respondWithCard } from './respond-with-card';
import {
  APPLICATION_LINKS,
  type ApplicationLinks,
} from './ports/application-links.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';
import { APPLICATIONS_CLOCK, type Clock } from './ports/clock.port';

/**
 * `POST /api/applications` (spec applications/tracking, "Seguir una oferta"). Solo se sigue lo que se ve: un link que
 * no está en la lista privada ni en un grupo de quien pide, uno que no existe o uno mal formado responden el mismo
 * `404 link_not_found` (D4). La fecha de postulación se valida con el reloj del servidor (D3). Si ya la seguía, responde
 * la existente intacta con `created: false`.
 */
@Injectable()
export class TrackLink {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: TrackLinkRequest,
  ): Promise<TrackLinkResponse> {
    if (!(await this.links.canRead(userId, request.linkId))) {
      throw new TrackedLinkNotFound();
    }
    const tracking = startTracking({
      userId,
      linkId: request.linkId,
      status: request.status,
      ...(request.stageLabel === undefined
        ? {}
        : { stageLabel: request.stageLabel }),
      ...(request.appliedAt === undefined
        ? {}
        : { appliedAt: new Date(request.appliedAt) }),
      now: this.clock.now(),
    });
    const { application, created } = await this.applications.create(tracking);
    return {
      application: await respondWithCard(this.links, application),
      created,
    };
  }
}
