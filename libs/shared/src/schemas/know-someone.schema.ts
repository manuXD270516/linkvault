import { z } from 'zod';

// Contratos del flag «conozco a alguien ahí» en un link de grupo (D2 de know-someone-flag). Sin userIds ni nombres:
// solo si quien mira lo marcó y cuántos lo marcaron. El SPA fusiona esta forma slim en el ítem de la lista.

/** Estado del flag en un link de grupo: conteo + si quien mira lo tiene marcado. */
export const knowSomeoneStateSchema = z.strictObject({
  flaggedByMe: z.boolean(),
  count: z.number().int().nonnegative(),
});
export type KnowSomeoneState = z.infer<typeof knowSomeoneStateSchema>;

/** Body de `PUT .../know-someone`: marcar o desmarcar. */
export const setKnowSomeoneRequestSchema = z.strictObject({
  flagged: z.boolean(),
});
export type SetKnowSomeoneRequest = z.infer<typeof setKnowSomeoneRequestSchema>;

/** Respuesta `200` del toggle: la misma forma que viaja en el listado del grupo. */
export const setKnowSomeoneResponseSchema = knowSomeoneStateSchema;
export type SetKnowSomeoneResponse = KnowSomeoneState;
