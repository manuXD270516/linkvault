import { z } from 'zod';

// Job de re-check de frescura (ADR-037): reutiliza la cola `enrich-link` con `triggeredBy: freshness` y un `jobId`
// determinista por ventana de cadencia (`fresh:{linkId}:{bucket}`).

/** Disparador del job de enrich cuando viene del detector de frescura. */
export const ENRICH_TRIGGERED_BY_FRESHNESS = 'freshness' as const;

export const enrichTriggeredBySchema = z.enum([ENRICH_TRIGGERED_BY_FRESHNESS]);
export type EnrichTriggeredBy = z.infer<typeof enrichTriggeredBySchema>;

/**
 * Payload del re-check: mismos campos que `LinkCreated.v1` más el disparador. El consumidor de enrich lo acepta.
 */
export const freshnessRecheckPayloadSchema = z.strictObject({
  linkId: z.string().min(1),
  previewVersion: z.number().int().positive(),
  triggeredBy: z.literal(ENRICH_TRIGGERED_BY_FRESHNESS),
});
export type FreshnessRecheckPayload = z.infer<
  typeof freshnessRecheckPayloadSchema
>;

/** Número de día UTC (días desde epoch UTC a medianoche). */
export function utcDayNumber(date: Date): number {
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) /
      86_400_000,
  );
}

/**
 * Cubo de cadencia: `floor(utcDayNumber / intervalDays)`. Dos re-checks del mismo link en la misma ventana
 * comparten `jobId` y BullMQ no duplica trabajo vivo.
 */
export function freshnessBucket(
  date: Date,
  intervalDays: number,
): number {
  const days = Math.max(1, Math.floor(intervalDays));
  return Math.floor(utcDayNumber(date) / days);
}

/**
 * `jobId` determinista (3 segmentos con `:` — regla BullMQ): `fresh:{linkId}:{bucket}`.
 */
export function freshnessRecheckJobId(
  linkId: string,
  bucket: number,
): string {
  return `fresh:${linkId}:${bucket}`;
}
