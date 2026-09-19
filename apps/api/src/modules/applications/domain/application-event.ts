import type { ApplicationStatus } from './application-status';

// Evento del historial de una postulación (D2, ADR-024 §1). Guarda origen y destino, y las etapas de ambos si las había;
// el tipo de gesto ("avanzó", "corrigió", "cerró", "reabrió") se deriva al pintar y no se guarda. No lleva notas: las
// notas son de la postulación y el historial es de estados.

/** Evento todavía sin guardar: el repositorio le pone su id, la postulación y el dueño. */
export interface NewApplicationEvent {
  /** Ausente en el primer evento, el del alta. */
  readonly from?: ApplicationStatus;
  readonly to: ApplicationStatus;
  readonly fromStageLabel?: string;
  readonly stageLabel?: string;
  readonly at: Date;
}

export interface ApplicationEvent extends NewApplicationEvent {
  readonly id: string;
  readonly applicationId: string;
  /** Duplicado para filtrar el historial por dueño sin leer la postulación. */
  readonly userId: string;
}
