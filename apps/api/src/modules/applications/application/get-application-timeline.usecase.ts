import type { ApplicationTimelineResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { ApplicationNotFound } from '../domain/errors';
import { toApplicationEventResponse } from './application.mapper';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';

/**
 * `GET /api/applications/:id/events` (spec applications/tracking, "Historial de la postulación"): los eventos de una
 * postulación propia, del más antiguo al más reciente. La ajena, la que no existe y la mal formada responden el mismo
 * `application_not_found`, también cuando no tendrían eventos.
 */
@Injectable()
export class GetApplicationTimeline {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
  ) {}

  async execute(
    userId: string,
    applicationId: string,
  ): Promise<ApplicationTimelineResponse> {
    const application = await this.applications.findOwned(
      applicationId,
      userId,
    );
    if (application === null) {
      throw new ApplicationNotFound();
    }
    const events = await this.applications.eventsOf(application.id, userId);
    return { items: events.map(toApplicationEventResponse) };
  }
}
