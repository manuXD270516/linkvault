// Límites antiabuso del módulo `groups` (D4). Se comprueban contando antes de escribir; como no hay transacción entre la
// cuenta y el alta, dos uniones simultáneas pueden dejar un grupo con 51 miembros. Es un límite antiabuso, no una
// invariante de negocio: lo que sí impide el índice único `(groupId, userId)` es una membresía duplicada.

/** Máximo de miembros de un grupo (spec groups/membership). */
export const MAX_MEMBERS_PER_GROUP = 50;

/** Máximo de grupos a los que pertenece un usuario (spec groups/group-management). */
export const MAX_GROUPS_PER_USER = 20;

/** Un grupo que ya tiene el máximo de miembros no admite uno más. */
export function isGroupFull(memberCount: number): boolean {
  return memberCount >= MAX_MEMBERS_PER_GROUP;
}

/**
 * Un usuario que ya está en el máximo de grupos no puede crear ni unirse a otro. Las membresías huérfanas (grupo
 * borrado) no cuentan: quien llama pasa el conteo que descarta esas membresías (D6).
 */
export function hasReachedGroupLimit(groupCount: number): boolean {
  return groupCount >= MAX_GROUPS_PER_USER;
}

/**
 * Límite de códigos de invitación incorrectos (ADR-025 §6): 10 por usuario y 100 por IP (IPv6 por /64) en una ventana fija
 * de 15 minutos, la de `auth`. Solo cuenta un código desconocido o mal formado; uno válido devuelve su intento.
 */
export const JOIN_ATTEMPTS_PER_USER = 10;
export const JOIN_ATTEMPTS_PER_IP = 100;
export const JOIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
