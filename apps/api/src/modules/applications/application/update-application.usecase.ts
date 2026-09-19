import type {
  Application as ApplicationResponse,
  UpdateApplicationRequest,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { editApplication } from '../domain/application.entity';
import { ApplicationNotFound } from '../domain/errors';
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
 * tocar `statusChangedAt`. Solo exige ser el dueño, vea o no el link todavía (ADR-024 §5).
 */
@Injectable()
export class UpdateApplication {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
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
    );
    if (updated === null) {
      throw new ApplicationNotFound();
    }
    return await respondWithCard(this.links, updated);
  }
}
