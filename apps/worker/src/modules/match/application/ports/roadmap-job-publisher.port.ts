import type { RoadmapRequestedPayload } from '@linkvault/shared';

/**
 * Encola `RoadmapRequested.v1` en BullMQ (opción A del design study-roadmap).
 *
 * El worker **no** escribe outbox al completar el match: tras `complete` exitoso se hace
 * `Queue.add` con `jobId` determinista (`roadmap:{analysisId}:build`). Ese jobId evita
 * duplicar el trabajo en la cola mientras BullMQ lo recuerda; el claim unique por
 * `analysisId` evita doble LLM aunque POST y auto encolen a la vez.
 */
export const ROADMAP_JOB_PUBLISHER = Symbol('ROADMAP_JOB_PUBLISHER');

export interface RoadmapJobPublisher {
  enqueue(payload: RoadmapRequestedPayload): Promise<void>;
}
