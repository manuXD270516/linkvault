import {
  ANALYSIS_STEP_CHANNEL,
  type AnalysisStepEvent,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { AnalysisStepNotifier } from '../../application/ports/analysis-step-notifier.port';

// Adaptador ANALYSIS_STEP_NOTIFIER sobre el canal Redis que `api` reparte por SSE (cv-suggestions-review §6).
// Publica el evento entero serializado; al otro lado se valida contra `analysisStepEventSchema` (strict).
//
// **Publicar no es parte del trabajo.** Cuando esto se llama, el paso ya se intentó persistir: si Redis no responde,
// lo único que se pierde es que el diálogo se entere solo (el sondeo sigue bastando). Un fallo aquí no se propaga.

/**
 * Lo que el adaptador necesita de Redis, declarado aquí en vez de con `Pick<Redis, …>`: un `Redis` de ioredis lo
 * cumple, y un doble de test también.
 */
export interface AnalysisStepPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
}

/** Lo que este adaptador necesita de un logger; `Logger` de Nest lo cumple. */
export interface AnalysisStepNotifierLogger {
  warn(message: string): void;
}

export class RedisAnalysisStepNotifier implements AnalysisStepNotifier {
  private reported = false;

  constructor(
    private readonly client: AnalysisStepPublisherClient,
    private readonly logger: AnalysisStepNotifierLogger = new Logger(
      'AnalysisStepNotifier',
    ),
  ) {}

  async publish(event: AnalysisStepEvent): Promise<void> {
    try {
      await this.client.publish(ANALYSIS_STEP_CHANNEL, JSON.stringify(event));
      this.reported = false;
    } catch (error: unknown) {
      this.report(error);
    }
  }

  private report(error: unknown): void {
    if (this.reported) return;
    this.reported = true;
    this.logger.warn(
      `could not announce an analysis step: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
