import type { GroupRole } from './membership';
import { isOwner } from './membership';

// Grupo (D1 de groups): la unidad que contiene a las personas y, más adelante, sus links. El documento NO guarda
// `ownerId`; la propiedad vive solo en la membresía con rol `owner`, así que no puede haber dos fuentes de verdad
// divergentes. `inviteCode` es único entre todos los grupos, no caduca y el owner puede rotarlo.

/** Longitud máxima de `name` tras eliminar espacios exteriores (spec groups/group-management). */
export const GROUP_NAME_MAX_LENGTH = 60;

/** Visibilidad por defecto de los links que entran en el grupo (D3 de public-preview-share). */
export type GroupVisibility = 'public' | 'private';

/**
 * Valor de un grupo que no tiene el ajuste guardado. `public` (decisión humana 3): los grupos que ya existían se
 * comportan como los nuevos y no hace falta migrar nada. Aun así **ningún link ya compartido se publica**: el ajuste
 * decide qué pasa al **entrar** un link, no lo que ya entró.
 */
export const DEFAULT_GROUP_VISIBILITY: GroupVisibility = 'public';

export interface Group {
  readonly id: string;
  /** Siempre normalizado (ver `normalizeGroupName`). No es único: dos grupos pueden llamarse igual. */
  readonly name: string;
  readonly inviteCode: string;
  /**
   * Si un link que entra en el grupo nace con enlace público. Un documento sin `settings` se lee
   * `DEFAULT_GROUP_VISIBILITY`, así que aquí nunca falta.
   */
  readonly defaultVisibility: GroupVisibility;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** Grupo aún no guardado: el repositorio le asigna el id. */
export type NewGroup = Omit<Group, 'id'>;

/** Nombre sin espacios exteriores. No juzga la longitud: para eso está `isValidGroupName`. */
export function normalizeGroupName(name: string): string {
  return name.trim();
}

/**
 * Entre 1 y 60 caracteres (code points, el mismo criterio que zod 4) tras normalizar. Los casos de uso lo comprueban
 * antes de escribir y rechazan con `InvalidGroupName`; el contrato HTTP ya rechaza lo mismo con `400`.
 */
export function isValidGroupName(name: string): boolean {
  const length = [...normalizeGroupName(name)].length;
  return length >= 1 && length <= GROUP_NAME_MAX_LENGTH;
}

/** Alta de un grupo con el código de invitación que le dio el generador. Nace compartiendo en público (D3). */
export function createGroup(params: {
  name: string;
  inviteCode: string;
  now: Date;
}): NewGroup {
  return {
    name: normalizeGroupName(params.name),
    inviteCode: params.inviteCode,
    defaultVisibility: DEFAULT_GROUP_VISIBILITY,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

/** Visibilidad guardada, o la de un grupo que nunca miró el ajuste. */
export function visibilityOf(
  stored: GroupVisibility | undefined,
): GroupVisibility {
  return stored ?? DEFAULT_GROUP_VISIBILITY;
}

/**
 * Cambiar la visibilidad por defecto es del owner; un miembro recibe `forbidden` (spec groups/group-management). Vive
 * aquí y no en `membership.ts` porque es una guarda sobre un ajuste del grupo, no sobre la membresía.
 */
export function canChangeDefaultVisibility(role: GroupRole): boolean {
  return isOwner(role);
}

/** Grupo con otra visibilidad por defecto. NO toca ningún link: solo decide lo que entre a partir de ahora (D3). */
export function withDefaultVisibility(
  group: Group,
  defaultVisibility: GroupVisibility,
  now: Date,
): Group {
  return { ...group, defaultVisibility, updatedAt: now };
}

/** Grupo renombrado, con el nombre normalizado y `updatedAt` en el instante del cambio. */
export function renameGroup(group: Group, name: string, now: Date): Group {
  return { ...group, name: normalizeGroupName(name), updatedAt: now };
}

/** Grupo con un código de invitación nuevo: el anterior deja de servir en cuanto se guarda. */
export function withInviteCode(
  group: Group,
  inviteCode: string,
  now: Date,
): Group {
  return { ...group, inviteCode, updatedAt: now };
}
