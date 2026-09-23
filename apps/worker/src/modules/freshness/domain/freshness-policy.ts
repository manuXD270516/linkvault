import type { Platform } from '@linkvault/shared';

/**
 * Plataformas cuyo `robots.txt` prohíbe la lectura automática (ADR-022 / ADR-023).
 * El detector aplaza la revisión sin scrape ni cierre.
 */
const NON_SCRAPEABLE_PLATFORMS = new Set<Platform>([
  'linkedin',
  'indeed',
  'computrabajo',
]);

export function isKnownNonScrapeablePlatform(platform: Platform): boolean {
  return NON_SCRAPEABLE_PLATFORMS.has(platform);
}

/** Día UTC de una fecha ISO `YYYY-MM-DD` o Date, como string de día. */
export function utcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * `true` si `expiresAt` (date-only o datetime) es estrictamente anterior al día UTC actual.
 */
export function isExpiresAtPast(expiresAt: string, now: Date): boolean {
  const day = expiresAt.length >= 10 ? expiresAt.slice(0, 10) : expiresAt;
  return day < utcDateString(now);
}
