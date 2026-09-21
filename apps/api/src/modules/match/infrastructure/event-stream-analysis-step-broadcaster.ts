import {
  ANALYSIS_STEP_EVENT_NAME,
  analysisStepMessage,
  type AnalysisStepMessage,
} from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { EventStreamRegistry } from '../../../infrastructure/realtime/event-stream.registry';
import type { AnalysisStepBroadcaster } from '../application/ports/analysis-step-broadcaster.port';

/**
 * Adaptador ANALYSIS_STEP_BROADCASTER sobre el registro de conexiones del canal de eventos.
 * El nombre del evento y la forma del cuerpo son del contrato de `libs/shared`.
 */
@Injectable()
export class EventStreamAnalysisStepBroadcaster
  implements AnalysisStepBroadcaster
{
  constructor(private readonly streams: EventStreamRegistry) {}

  hasListeners(): boolean {
    return this.streams.hasListeners;
  }

  send(userId: string, message: AnalysisStepMessage): number {
    return this.streams.publish(
      userId,
      ANALYSIS_STEP_EVENT_NAME,
      JSON.stringify(analysisStepMessage(message)),
    );
  }
}
