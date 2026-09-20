import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from '../application/ports/analysis-repository.port';

/**
 * Lector de puntuaciones para el registro de `applications` (D11). Vive en `match/infrastructure` y **no** importa tipos
 * de `applications`: los límites entre módulos solo dejan entrar desde `presentation`, que es donde se cablea. Allí, al
 * registrarlo, se comprueba que esta clase encaja con `ApplicationFitScoreSource`.
 */
@Injectable()
export class MatchFitScoreReader {
  constructor(
    @Inject(ANALYSIS_REPOSITORY)
    private readonly analyses: AnalysisRepository,
  ) {}

  scoresFor(
    userId: string,
    linkIds: readonly string[],
  ): ReturnType<AnalysisRepository['findLatestDoneFitScores']> {
    return this.analyses.findLatestDoneFitScores(userId, linkIds);
  }
}
