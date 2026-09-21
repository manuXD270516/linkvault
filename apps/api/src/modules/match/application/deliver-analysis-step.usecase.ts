import type { AnalysisStepPayload } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import {
  ANALYSIS_STEP_BROADCASTER,
  type AnalysisStepBroadcaster,
} from './ports/analysis-step-broadcaster.port';

/**
 * Reparto de un aviso de paso de análisis (cv-suggestions-review, platform/realtime): solo al `userId` del aviso.
 * Sin miembros de grupo ni lista privada —el análisis es personal. Si nadie escucha, se descarta sin error.
 */
@Injectable()
export class DeliverAnalysisStep {
  constructor(
    @Inject(ANALYSIS_STEP_BROADCASTER)
    private readonly broadcaster: AnalysisStepBroadcaster,
  ) {}

  /** Reparte el aviso y devuelve a cuántas conexiones llegó. Cero es un resultado normal, no un error. */
  execute(notice: AnalysisStepPayload): number {
    if (!this.broadcaster.hasListeners()) {
      return 0;
    }
    return this.broadcaster.send(notice.userId, {
      analysisId: notice.analysisId,
      linkId: notice.linkId,
      step: notice.step,
    });
  }
}
