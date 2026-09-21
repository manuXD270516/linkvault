import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { DeliverAnalysisStep } from '../application/deliver-analysis-step.usecase';
import {
  ANALYSIS_STEP_NOTICES,
  type AnalysisStepNotices,
} from '../application/ports/analysis-step-notices.port';

/**
 * Suscripción al canal de avisos de paso de análisis (cv-suggestions-review). Una por proceso.
 * Suscribirse no puede tumbar el arranque: sin Redis, `api` sigue sirviendo y el sondeo basta.
 */
@Injectable()
export class AnalysisStepSubscription
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AnalysisStepSubscription.name);
  private unsubscribe: (() => Promise<void>) | undefined;

  constructor(
    @Inject(ANALYSIS_STEP_NOTICES) private readonly notices: AnalysisStepNotices,
    private readonly deliver: DeliverAnalysisStep,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      this.unsubscribe = await this.notices.subscribe(async (payload) => {
        this.deliver.execute(payload);
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(
        `Could not subscribe to analysis step notices (${name}); open screens will not update on their own`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    const unsubscribe = this.unsubscribe;
    this.unsubscribe = undefined;
    if (unsubscribe !== undefined) {
      await unsubscribe().catch(() => undefined);
    }
  }
}
