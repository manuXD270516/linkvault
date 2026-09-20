import { z } from 'zod';

// Contratos HTTP del módulo `groups` (D9 de groups). El formato estricto del código de invitación (longitud y alfabeto)
// NO se valida aquí: lo juzga el dominio, para que un código mal pegado responda `invalid_invite_code` (404) y no el
// `validation_error` (400) genérico del pipe, que el SPA no sabría explicar.

/** Longitud máxima de `name` tras eliminar espacios exteriores (spec groups/group-management). */
export const GROUP_NAME_MAX_LENGTH = 60;

/** Cota de cordura del código recibido: evita gastar una consulta en una cadena arbitrariamente larga. */
export const INVITE_CODE_INPUT_MAX_LENGTH = 64;

/** Nombre del grupo: entre 1 y 60 caracteres tras eliminar espacios exteriores. */
export const groupNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(GROUP_NAME_MAX_LENGTH);

/** Código de invitación recibido: espacios exteriores eliminados y mayúsculas; solo cadena no vacía de hasta 64. */
export const inviteCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(INVITE_CODE_INPUT_MAX_LENGTH);

/** Rol dentro de un grupo. La propiedad vive en la membresía `owner`, no en el grupo. */
export const groupRoleSchema = z.enum(['owner', 'member']);
export type GroupRole = z.infer<typeof groupRoleSchema>;

/** Cuerpo de `POST /api/groups`. */
export const createGroupRequestSchema = z.object({
  name: groupNameSchema,
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;

/** Cuerpo de `PATCH /api/groups/:id`. */
export const renameGroupRequestSchema = z.object({
  name: groupNameSchema,
});
export type RenameGroupRequest = z.infer<typeof renameGroupRequestSchema>;

/**
 * Visibilidad por defecto de los links que **entran** en el grupo (D3 de public-preview-share, ADR-027 §7). Un enum y no
 * un booleano: deja sitio a un tercer valor —"solo con enlace y con contraseña"— sin migrar nada.
 */
export const groupVisibilitySchema = z.enum(['public', 'private']);
export type GroupVisibility = z.infer<typeof groupVisibilitySchema>;

/**
 * Cuerpo de `PATCH /api/groups/:id/settings`. Ruta propia en vez de ampliar `PATCH /api/groups/:id`, que hoy exige
 * `name`: hacer `name` opcional debilitaría el renombrado y obligaría a un "al menos un campo" en un contrato bien
 * probado.
 */
export const updateGroupSettingsRequestSchema = z.object({
  defaultVisibility: groupVisibilitySchema,
});
export type UpdateGroupSettingsRequest = z.infer<
  typeof updateGroupSettingsRequestSchema
>;

/** Cuerpo de `POST /api/groups/join`. */
export const joinGroupRequestSchema = z.object({
  code: inviteCodeSchema,
});
export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;

/**
 * Cuerpo de `POST /api/groups/:id/owner`: el miembro que pasa a ser `owner`. El formato del identificador NO se valida
 * aquí: un `userId` mal formado responde `member_not_found` (404), igual que uno que no es miembro del grupo.
 */
export const transferOwnershipRequestSchema = z.object({
  userId: z.string().min(1),
});
export type TransferOwnershipRequest = z.infer<
  typeof transferOwnershipRequestSchema
>;

/**
 * Grupo en la lista del usuario y en la respuesta de unión. Estricto a propósito: esta forma NUNCA lleva el código de
 * invitación, tampoco cuando el rol resuelto es `owner`.
 */
export const groupSummarySchema = z.strictObject({
  id: z.string().min(1),
  name: groupNameSchema,
  role: groupRoleSchema,
  memberCount: z.number().int().nonnegative(),
  joinedAt: z.iso.datetime(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

/**
 * Detalle de un grupo. `inviteCode` solo viaja cuando el rol resuelto es `owner`; `defaultVisibility` viaja para
 * **cualquier miembro**, porque quien comparte un link tiene derecho a saber si va a nacer público (D3). Un grupo
 * guardado sin el ajuste se lee como `public`, así que el campo nunca falta en la respuesta.
 */
export const groupDetailSchema = z.strictObject({
  id: z.string().min(1),
  name: groupNameSchema,
  role: groupRoleSchema,
  memberCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  inviteCode: z.string().min(1).optional(),
  defaultVisibility: groupVisibilitySchema,
});
export type GroupDetail = z.infer<typeof groupDetailSchema>;

/** Cuerpo de `POST /api/groups/:id/invite-code`. */
export const inviteCodeResponseSchema = z.strictObject({
  inviteCode: z.string().min(1),
});
export type InviteCodeResponse = z.infer<typeof inviteCodeResponseSchema>;

/** Miembro en `GET /api/groups/:id/members`. Estricto: el email nunca sale de `users`. */
export const groupMemberSchema = z.strictObject({
  userId: z.string().min(1),
  displayName: z.string().min(1),
  role: groupRoleSchema,
  joinedAt: z.iso.datetime(),
});
export type GroupMember = z.infer<typeof groupMemberSchema>;
