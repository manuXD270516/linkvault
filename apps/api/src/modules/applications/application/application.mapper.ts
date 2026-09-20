import type {
  Application as ApplicationResponse,
  ApplicationEvent as ApplicationEventResponse,
  ApplicationLinkCard,
} from '@linkvault/shared';
import type { Application } from '../domain/application.entity';
import type { ApplicationEvent } from '../domain/application-event';
import type { LinkFitScore } from './application-fit-scores';
import type { LinkCard } from './ports/application-links.port';

// Representación de una postulación en la API (D10 de applications-tracking; D11 de cv-match-suggestions). Se escribe
// campo a campo, nunca con un spread del dominio: así no salen campos internos ni el `userId` del dueño. `fitScore` /
// `fitScoreDegraded` llegan derivados del último análisis `done` (si lo hay); un análisis básico solo aporta la marca.

/** Campos de puntuación para la respuesta: nunca `0` por ausencia; degradado → marca sin número. */
export function fitScoreFields(
  fit: LinkFitScore | undefined,
): Pick<ApplicationResponse, 'fitScore' | 'fitScoreDegraded'> {
  if (fit === undefined) {
    return {};
  }
  if (fit.degraded) {
    return { fitScoreDegraded: true };
  }
  return { fitScore: fit.score, fitScoreDegraded: false };
}

export function toLinkCard(card: LinkCard): ApplicationLinkCard {
  return {
    id: card.id,
    displayUrl: card.displayUrl,
    platform: card.platform,
    previewStatus: card.previewStatus,
    ...(card.title === undefined ? {} : { title: card.title }),
    ...(card.company === undefined ? {} : { company: card.company }),
  };
}

export function toApplicationResponse(
  application: Application,
  card: LinkCard,
  fit?: LinkFitScore,
): ApplicationResponse {
  return {
    id: application.id,
    linkId: application.linkId,
    status: application.status,
    ...(application.stageLabel === undefined
      ? {}
      : { stageLabel: application.stageLabel }),
    visibility: application.visibility,
    notes: application.notes,
    ...(application.appliedAt === undefined
      ? {}
      : { appliedAt: application.appliedAt.toISOString() }),
    statusChangedAt: application.statusChangedAt.toISOString(),
    version: application.version,
    createdAt: application.createdAt.toISOString(),
    updatedAt: application.updatedAt.toISOString(),
    link: toLinkCard(card),
    ...fitScoreFields(fit),
  };
}

export function toApplicationEventResponse(
  event: ApplicationEvent,
): ApplicationEventResponse {
  return {
    id: event.id,
    ...(event.from === undefined ? {} : { from: event.from }),
    to: event.to,
    ...(event.fromStageLabel === undefined
      ? {}
      : { fromStageLabel: event.fromStageLabel }),
    ...(event.stageLabel === undefined ? {} : { stageLabel: event.stageLabel }),
    at: event.at.toISOString(),
  };
}
