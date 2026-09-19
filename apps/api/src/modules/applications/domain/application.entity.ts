import type { NewApplicationEvent } from './application-event';
import { resolveAppliedAt } from './applied-at';
import {
  isSameState,
  type ApplicationState,
  type ApplicationStatus,
} from './application-status';
import { InvalidNotes } from './errors';
import { resolveStageLabel, type RequestedStageLabel } from './stage-label';

// Postulación (D2): una por persona y oferta, privada al nacer. El estado y la etapa van protegidos por `version`
// (ADR-024 §4); las notas y la visibilidad son "última escritura gana" y no la tocan. `statusChangedAt` cambia solo con
// el estado o la etapa, así que editar una nota o el interruptor no reordena los avatares del grupo ni reinicia la
// cuenta de días de `ApplicationStale.v1`.

export const APPLICATION_VISIBILITIES = ['private', 'group'] as const;
export type ApplicationVisibility = (typeof APPLICATION_VISIBILITIES)[number];

/** Notas privadas: hasta 2000 caracteres; la cadena vacía las borra. */
export const APPLICATION_NOTES_MAX_LENGTH = 2000;

/** Versión de una postulación recién creada. */
export const INITIAL_APPLICATION_VERSION = 1;

export interface Application {
  readonly id: string;
  readonly userId: string;
  readonly linkId: string;
  readonly status: ApplicationStatus;
  /** Solo en `in_process`. */
  readonly stageLabel?: string;
  readonly visibility: ApplicationVisibility;
  readonly notes: string;
  readonly appliedAt?: Date;
  readonly statusChangedAt: Date;
  /**
   * Puntuación de encaje (0–100) reservada para `cv-match-suggestions` (D9). En este change nada la escribe y ninguna
   * respuesta la lleva: no hay método de este módulo que la cambie.
   */
  readonly fitScore?: number;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Postulación aún no guardada: el repositorio le asigna el id. */
export type NewApplication = Omit<Application, 'id' | 'fitScore'>;

/** Alta de una postulación con su primer evento, que se escriben juntos. */
export interface StartedTracking {
  readonly application: NewApplication;
  readonly event: NewApplicationEvent;
}

/**
 * Seguir un link (D4): nace privada, con `version` 1, sin notas, con `statusChangedAt` en el alta y un primer evento sin
 * estado de origen. La etapa y la fecha siguen las mismas reglas que un cambio de estado.
 */
export function startTracking(params: {
  readonly userId: string;
  readonly linkId: string;
  readonly status: ApplicationStatus;
  readonly stageLabel?: RequestedStageLabel;
  readonly appliedAt?: Date;
  readonly now: Date;
}): StartedTracking {
  const { userId, linkId, status, now } = params;
  const stageLabel = resolveStageLabel({
    to: status,
    requested: params.stageLabel,
  });
  const appliedAt = resolveAppliedAt({
    to: status,
    ...(params.appliedAt === undefined ? {} : { requested: params.appliedAt }),
    now,
  });
  return {
    application: {
      userId,
      linkId,
      status,
      ...(stageLabel === undefined ? {} : { stageLabel }),
      visibility: 'private',
      notes: '',
      ...(appliedAt === undefined ? {} : { appliedAt }),
      statusChangedAt: now,
      version: INITIAL_APPLICATION_VERSION,
      createdAt: now,
      updatedAt: now,
    },
    event: {
      to: status,
      ...(stageLabel === undefined ? {} : { stageLabel }),
      at: now,
    },
  };
}

/** Lo que pide un cambio de estado. `stageLabel` omitida y `null` no son lo mismo (D2). */
export interface StatusChangeRequest {
  readonly status: ApplicationStatus;
  readonly stageLabel?: RequestedStageLabel;
  readonly appliedAt?: Date;
}

/**
 * Escritura de un cambio efectivo, condicionada a `expectedVersion`. `stageLabel` y `appliedAt` ausentes significan
 * "quitar el campo".
 */
export interface StatusWrite {
  readonly expectedVersion: number;
  readonly status: ApplicationStatus;
  readonly stageLabel?: string;
  readonly appliedAt?: Date;
  readonly statusChangedAt: Date;
  readonly updatedAt: Date;
}

export type StatusChange =
  /** Mismo estado y misma etapa: no se escribe nada ni se mira la versión. */
  | { readonly kind: 'unchanged' }
  | {
      readonly kind: 'changed';
      readonly write: StatusWrite;
      readonly event: NewApplicationEvent;
      /** La postulación tal y como queda si la escritura casa. */
      readonly next: Application;
    };

/**
 * Cambio de estado o de etapa (D2, D3, D5). Transiciones libres: no hay pares prohibidos. Calcula el estado y la etapa
 * resultantes y, si son los que ya tiene, responde "sin cambios" **antes** de mirar la fecha o la versión: un doble clic
 * desde una pestaña vieja no es un conflicto. Si hay cambio, sube la versión en 1, fija `statusChangedAt` y deja un
 * evento con origen, destino y las etapas de ambos.
 */
export function changeStatus(
  current: Application,
  request: StatusChangeRequest,
  now: Date,
): StatusChange {
  const stageLabel = resolveStageLabel({
    from: current.status,
    ...(current.stageLabel === undefined
      ? {}
      : { current: current.stageLabel }),
    to: request.status,
    requested: request.stageLabel,
  });
  const next: ApplicationState = {
    status: request.status,
    ...(stageLabel === undefined ? {} : { stageLabel }),
  };
  if (isSameState(current, next)) {
    return { kind: 'unchanged' };
  }
  const appliedAt = resolveAppliedAt({
    to: request.status,
    ...(current.appliedAt === undefined ? {} : { current: current.appliedAt }),
    ...(request.appliedAt === undefined
      ? {}
      : { requested: request.appliedAt }),
    now,
  });
  const write: StatusWrite = {
    expectedVersion: current.version,
    status: request.status,
    ...(stageLabel === undefined ? {} : { stageLabel }),
    ...(appliedAt === undefined ? {} : { appliedAt }),
    statusChangedAt: now,
    updatedAt: now,
  };
  const {
    stageLabel: _previousStage,
    appliedAt: _previousDate,
    ...rest
  } = current;
  return {
    kind: 'changed',
    write,
    event: {
      from: current.status,
      to: request.status,
      ...(current.stageLabel === undefined
        ? {}
        : { fromStageLabel: current.stageLabel }),
      ...(stageLabel === undefined ? {} : { stageLabel }),
      at: now,
    },
    next: {
      ...rest,
      status: request.status,
      ...(stageLabel === undefined ? {} : { stageLabel }),
      ...(appliedAt === undefined ? {} : { appliedAt }),
      statusChangedAt: now,
      updatedAt: now,
      version: current.version + 1,
    },
  };
}

/** Lo que pide una edición: notas, visibilidad o ambas. */
export interface ApplicationEdit {
  readonly notes?: string;
  readonly visibility?: ApplicationVisibility;
}

/** Escritura de una edición: sin evento, sin versión y sin tocar `statusChangedAt` (D5). */
export interface EditWrite {
  readonly notes?: string;
  readonly visibility?: ApplicationVisibility;
  readonly updatedAt: Date;
}

/**
 * Editar notas y visibilidad (D2, D5): última escritura gana. No escribe evento, no sube `version` y no toca
 * `statusChangedAt`: una nota no es un avance del proceso. Notas de más de 2000 caracteres → `InvalidNotes`.
 */
export function editApplication(edit: ApplicationEdit, now: Date): EditWrite {
  if (
    edit.notes !== undefined &&
    edit.notes.length > APPLICATION_NOTES_MAX_LENGTH
  ) {
    throw new InvalidNotes();
  }
  return {
    ...(edit.notes === undefined ? {} : { notes: edit.notes }),
    ...(edit.visibility === undefined ? {} : { visibility: edit.visibility }),
    updatedAt: now,
  };
}
