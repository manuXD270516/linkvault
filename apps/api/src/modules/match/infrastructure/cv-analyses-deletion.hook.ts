import { Inject, Injectable } from '@nestjs/common';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from '../application/ports/analysis-repository.port';

/**
 * Limpieza de `match` cuando se borra un CV (ADR-030 §4): se borran los análisis hechos con él —incluidos sus
 * fragmentos de evidencia— **dentro** de la transacción de `cv`. Corre con la sesión que le pasan; o se borra todo o
 * no se borra nada.
 *
 * No importa el tipo `CvDeletionHook` de `cv` a propósito: los límites entre módulos solo dejan entrar a otro módulo
 * desde `presentation`, que es donde se cablea. Allí, al registrarlo, se comprueba que esta clase encaja.
 */
@Injectable()
export class CvAnalysesDeletionHook {
  constructor(
    @Inject(ANALYSIS_REPOSITORY)
    private readonly analyses: AnalysisRepository,
  ) {}

  async deleteRelationsOf(
    cvId: string,
    userId: string,
    session: TransactionSession,
  ): Promise<void> {
    await this.analyses.removeByCv(userId, cvId, session);
  }
}
