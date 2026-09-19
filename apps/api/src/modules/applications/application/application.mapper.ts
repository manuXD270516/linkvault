import type {
  Application as ApplicationResponse,
  ApplicationEvent as ApplicationEventResponse,
  ApplicationLinkCard,
} from '@linkvault/shared';
import type { Application } from '../domain/application.entity';
import type { ApplicationEvent } from '../domain/application-event';
import type { LinkCard } from './ports/application-links.port';

// Representación de una postulación en la API (D10 de applications-tracking). Se escribe campo a campo, nunca con un
// spread del dominio: así `fitScore`, reservado para `cv-match-suggestions`, no sale aunque el documento lo tenga (D9),
// y tampoco el `userId` del dueño, que la respuesta no necesita.

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
