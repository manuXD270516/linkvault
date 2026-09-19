import { Inject, Injectable } from '@nestjs/common';
import { ApplicationNotFound } from '../domain/errors';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';

/**
 * `DELETE /api/applications/:id` (spec applications/tracking, "Dejar de seguir"; ADR-024 §8): borra la postulación y
 * todo su historial en una transacción, solo para su dueño. Sin borrado lógico: deja de verse en el tablero y en los
 * grupos por la misma derivación de siempre. Volver a seguir la oferta crea una postulación nueva.
 */
@Injectable()
export class UntrackApplication {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
  ) {}

  async execute(userId: string, applicationId: string): Promise<void> {
    if (!(await this.applications.delete(applicationId, userId))) {
      throw new ApplicationNotFound();
    }
  }
}
