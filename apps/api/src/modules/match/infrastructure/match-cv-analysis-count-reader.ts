import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from '../application/ports/analysis-repository.port';

/**
 * Lector de recuentos por CV para el registro de `cv` (tarea 11.4). No importa tipos de `cv`: el cableado vive en
 * `presentation`.
 */
@Injectable()
export class MatchCvAnalysisCountReader {
  constructor(
    @Inject(ANALYSIS_REPOSITORY)
    private readonly analyses: AnalysisRepository,
  ) {}

  countsByCv(userId: string): Promise<ReadonlyMap<string, number>> {
    return this.analyses.countByCv(userId);
  }
}
