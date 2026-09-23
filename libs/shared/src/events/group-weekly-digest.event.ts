import { z } from 'zod';

// Digest semanal de grupo (change group-weekly-digest, ADR-035 enmienda B10).
// Job raíz en worker (sin outbox): single-flight por weekKey ISO W−1.

/** Cola BullMQ del digest semanal de grupo. */
export const GROUP_DIGEST_QUEUE = 'group-digest';

/** Nombre del job raíz semanal. */
export const GROUP_DIGEST_JOB_NAME = 'week';

/** Tipo de preferencia / ledger. */
export const GROUP_WEEKLY_DIGEST_TYPE = 'group_weekly_digest' as const;

/** Tope de títulos en el cuerpo del email. */
export const GROUP_DIGEST_MAX_TITLES = 10;

/** weekKey ISO: `YYYY-Www` (semana cerrada W−1). */
export const groupDigestWeekKeySchema = z
  .string()
  .regex(/^\d{4}-W\d{2}$/);
export type GroupDigestWeekKey = z.infer<typeof groupDigestWeekKeySchema>;

export const groupDigestJobPayloadSchema = z.strictObject({
  weekKey: groupDigestWeekKeySchema,
});
export type GroupDigestJobPayload = z.infer<typeof groupDigestJobPayloadSchema>;

/**
 * jobId single-flight del job raíz.
 * Tres segmentos con `:` (convención BullMQ del monorepo).
 */
export function groupDigestJobId(weekKey: string): string {
  return `digest:week:${weekKey}`;
}

/** aggregateKey del ledger: `${weekKey}:${groupId}`. */
export function groupDigestAggregateKey(
  weekKey: string,
  groupId: string,
): string {
  return `${weekKey}:${groupId}`;
}
