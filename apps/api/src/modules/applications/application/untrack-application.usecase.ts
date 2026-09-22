import { Inject, Injectable, Optional } from '@nestjs/common';
import { SearchFacade } from '../../search/application/search.facade';
import { ApplicationNotFound } from '../domain/errors';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';

/**
 * `DELETE /api/applications/:id` (spec applications/tracking, "Dejar de seguir"; ADR-024 §8): borra la postulación y
 * todo su historial en una transacción, solo para su dueño. Sin borrado lógico: deja de verse en el tablero y en los
 * grupos por la misma derivación de siempre. Volver a seguir la oferta crea una postulación nueva.
 * SearchDelete en la misma txn si FEATURE_SEARCH.
 */
@Injectable()
export class UntrackApplication {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Optional() private readonly search?: SearchFacade,
  ) {}

  async execute(userId: string, applicationId: string): Promise<void> {
    const deleted = await this.applications.delete(
      applicationId,
      userId,
      this.search === undefined
        ? undefined
        : async (session) => {
            await this.search?.delete(
              {
                docType: 'application',
                aggregateId: applicationId,
                reason: 'aggregate_deleted',
              },
              session,
            );
          },
    );
    if (!deleted) {
      throw new ApplicationNotFound();
    }
  }
}
