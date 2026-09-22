import type {
  Application as ApplicationResponse,
  UpdateApplicationRequest,
} from '@linkvault/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { SearchFacade } from '../../search/application/search.facade';
import { editApplication } from '../domain/application.entity';
import { ApplicationNotFound } from '../domain/errors';
import { ApplicationFitScores } from './application-fit-scores';
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
 * `PATCH /api/applications/:id` (specs applications/tracking "Notas privadas" y applications/group-visibility "Un
 * interruptor para compartir el estado"): notas y visibilidad, última escritura gana, sin evento, sin versión y sin
 * tocar `statusChangedAt`. Solo exige ser el dueño, vea o no el link todavía (ADR-024 §5). SearchUpsert si FEATURE_SEARCH.
 */
@Injectable()
export class UpdateApplication {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
    private readonly fitScores: ApplicationFitScores,
    @Optional() private readonly search?: SearchFacade,
  ) {}

  async execute(
    userId: string,
    applicationId: string,
    request: UpdateApplicationRequest,
  ): Promise<ApplicationResponse> {
    const write = editApplication(
      {
        ...(request.notes === undefined ? {} : { notes: request.notes }),
        ...(request.visibility === undefined
          ? {}
          : { visibility: request.visibility }),
      },
      this.clock.now(),
    );
    const updated = await this.applications.update(
      applicationId,
      userId,
      write,
      this.search === undefined
        ? undefined
        : async (session, application) => {
            await this.search?.upsert(
              {
                docType: 'application',
                aggregateId: application.id,
                reason: 'application_upsert',
                fingerprint: `app:${application.id}:${application.notes ?? ''}:${application.visibility}:${application.updatedAt.toISOString()}`,
              },
              session,
            );
          },
    );
    if (updated === null) {
      throw new ApplicationNotFound();
    }
    return await respondWithCard(this.links, this.fitScores, updated);
  }
}
