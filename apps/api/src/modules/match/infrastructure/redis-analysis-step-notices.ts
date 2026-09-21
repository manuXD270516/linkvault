import {
  ANALYSIS_STEP_CHANNEL,
  analysisStepEventSchema,
  type AnalysisStepPayload,
} from '@linkvault/shared';
import { Logger } from '@nestjs/common';
import type { RedisSubscriber } from '../../../infrastructure/redis/redis-subscriber-client';
import type { AnalysisStepNotices } from '../application/ports/analysis-step-notices.port';

// Adaptador ANALYSIS_STEP_NOTICES sobre el canal `events:analysis.step`. Comparte el cliente suscriptor del proceso
// (`REDIS_SUBSCRIBER_CLIENT`) con enriquecimiento y comentarios: una sola conexión, tres canales. Filtra por canal y
// valida el contrato estricto antes de tocar nada. Nunca se registra el contenido del mensaje.

export interface AnalysisStepNoticesLogger {
  warn(message: string): void;
}

export class RedisAnalysisStepNotices implements AnalysisStepNotices {
  private warned = false;

  constructor(
    private readonly client: RedisSubscriber,
    private readonly logger: AnalysisStepNoticesLogger = new Logger(
      RedisAnalysisStepNotices.name,
    ),
  ) {}

  async subscribe(
    handler: (payload: AnalysisStepPayload) => Promise<void>,
  ): Promise<() => Promise<void>> {
    const onMessage = (channel: string, message: string): void => {
      if (channel !== ANALYSIS_STEP_CHANNEL) {
        return;
      }
      void this.deliver(message, handler);
    };
    const onReady = (): void => {
      void this.listenOnChannel();
    };
    this.client.on('message', onMessage);
    this.client.on('ready', onReady);
    await this.open();
    return async () => {
      this.client.off('message', onMessage);
      this.client.off('ready', onReady);
      await this.client.unsubscribe(ANALYSIS_STEP_CHANNEL);
    };
  }

  private async open(): Promise<void> {
    if (this.client.status === 'ready') {
      await this.listenOnChannel();
      return;
    }
    if (this.client.status === 'wait') {
      this.client.connect().catch((error: unknown) => this.warnOnce(error));
    }
  }

  private async listenOnChannel(): Promise<void> {
    try {
      await this.client.subscribe(ANALYSIS_STEP_CHANNEL);
      this.warned = false;
    } catch (error) {
      this.warnOnce(error);
    }
  }

  private warnOnce(error: unknown): void {
    if (this.warned) {
      return;
    }
    this.warned = true;
    const name = error instanceof Error ? error.name : 'UnknownError';
    this.logger.warn(
      `Could not subscribe to analysis step notices (${name}); open screens will not update on their own until Redis is back`,
    );
  }

  private async deliver(
    message: string,
    handler: (payload: AnalysisStepPayload) => Promise<void>,
  ): Promise<void> {
    const parsed = this.parse(message);
    if (parsed === null) {
      return;
    }
    try {
      await handler(parsed);
    } catch (error) {
      const name = error instanceof Error ? error.name : 'UnknownError';
      this.logger.warn(`Could not deliver an analysis step notice (${name})`);
    }
  }

  private parse(message: string): AnalysisStepPayload | null {
    let body: unknown;
    try {
      body = JSON.parse(message);
    } catch {
      this.logger.warn('Discarded an analysis step notice that is not valid JSON');
      return null;
    }
    const event = analysisStepEventSchema.safeParse(body);
    if (!event.success) {
      this.logger.warn(
        'Discarded an analysis step notice that does not match its contract',
      );
      return null;
    }
    return event.data.payload;
  }
}
