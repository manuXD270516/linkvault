// Grupo (D1 de groups): la unidad que contiene a las personas y, más adelante, sus links. El documento NO guarda
// `ownerId`; la propiedad vive solo en la membresía con rol `owner`, así que no puede haber dos fuentes de verdad
// divergentes. `inviteCode` es único entre todos los grupos, no caduca y el owner puede rotarlo.

/** Longitud máxima de `name` tras eliminar espacios exteriores (spec groups/group-management). */
export const GROUP_NAME_MAX_LENGTH = 60;

export interface Group {
  readonly id: string;
  /** Siempre normalizado (ver `normalizeGroupName`). No es único: dos grupos pueden llamarse igual. */
  readonly name: string;
  readonly inviteCode: string;
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

/** Alta de un grupo con el código de invitación que le dio el generador. */
export function createGroup(params: {
  name: string;
  inviteCode: string;
  now: Date;
}): NewGroup {
  return {
    name: normalizeGroupName(params.name),
    inviteCode: params.inviteCode,
    createdAt: params.now,
    updatedAt: params.now,
  };
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
