// Vencimiento de un análisis en curso en el worker (ADR-030 §7). Misma regla que la API: justo en
// `requestedAt + maxAgeMs` todavía corre; vence con el milisegundo siguiente.

export function isRunningExpired(
  analysis: { readonly status: string; readonly requestedAt: Date },
  maxAgeMs: number,
  now: Date,
): boolean {
  if (analysis.status !== 'running') {
    return false;
  }
  return now.getTime() > analysis.requestedAt.getTime() + maxAgeMs;
}

/** Instantánea mínima todavía en plazo: `requestedAt >= now - maxAgeMs`. */
export function earliestRequestedAtStillRunning(
  maxAgeMs: number,
  now: Date,
): Date {
  return new Date(now.getTime() - maxAgeMs);
}
