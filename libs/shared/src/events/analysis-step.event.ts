import { z } from 'zod';
import { matchStepSchema } from '../match/match-steps';

// Aviso de que un análisis de encaje cambió de paso (cv-suggestions-review, design §6; platform/realtime).
// Cruza procesos por Redis: el worker lo publica al avanzar y `api` lo reparte por SSE solo al dueño del análisis.
// Va versionado en el propio `type`, como `LinkEnriched.v1`.
//
// El aviso de Redis lleva `userId` para enrutar sin inventar destinatarios. El mensaje SSE al navegador es más
// estrecho a propósito: solo `analysisId`, `linkId` y `step` —sin CV, oferta, sugerencias, score ni prompt.

/** Canal de Redis donde viaja el aviso. Lo comparten el publicador del worker y el suscriptor de `api`. */
export const ANALYSIS_STEP_CHANNEL = 'events:analysis.step';

/** Tipo versionado del evento interno worker→api. */
export const ANALYSIS_STEP_EVENT_TYPE = 'AnalysisStep.v1';

/**
 * Datos del aviso interno. `userId` es del dueño del análisis: `api` reparte solo a esa persona. El paso es del
 * conjunto cerrado de `match-steps`.
 */
export const analysisStepPayloadSchema = z.strictObject({
  analysisId: z.string().min(1),
  linkId: z.string().min(1),
  step: matchStepSchema,
  userId: z.string().min(1),
});
export type AnalysisStepPayload = z.infer<typeof analysisStepPayloadSchema>;

/** Evento completo, con su tipo versionado. */
export const analysisStepEventSchema = z.strictObject({
  type: z.literal(ANALYSIS_STEP_EVENT_TYPE),
  payload: analysisStepPayloadSchema,
});
export type AnalysisStepEvent = z.infer<typeof analysisStepEventSchema>;

/** Aviso listo para publicar a partir del paso que acaba de guardarse. */
export function analysisStepEvent(
  payload: AnalysisStepPayload,
): AnalysisStepEvent {
  return { type: ANALYSIS_STEP_EVENT_TYPE, payload };
}

// ---------------------------------------------------------------------------------------------------------------
// Lo anterior es el aviso **interno** worker→api. Lo que sigue es el mensaje **api→navegador** del canal SSE:
// mismos identificadores y paso, **sin** `userId` ni ningún otro campo.

/** Nombre del evento SSE (línea `event:`). Lo comparten el que reparte en `api` y el que escucha en el SPA. */
export const ANALYSIS_STEP_EVENT_NAME = 'analysis.step';

/**
 * Cuerpo del evento SSE (línea `data:`): solo análisis, oferta y paso. Un campo de más (score, sugerencias, CV,
 * userId) **invalida** —el canal no es un atajo para filtrar metadatos laborales.
 */
export const analysisStepMessageSchema = z.strictObject({
  analysisId: z.string().min(1),
  linkId: z.string().min(1),
  step: matchStepSchema,
});
export type AnalysisStepMessage = z.infer<typeof analysisStepMessageSchema>;

/** Mensaje listo para el canal a partir del paso que api acaba de enrutar al dueño. */
export function analysisStepMessage(
  message: AnalysisStepMessage,
): AnalysisStepMessage {
  return message;
}
