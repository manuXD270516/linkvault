// Retención de los snapshots de enriquecimiento (spec `cv/documents`, «Retención de snapshots de enriquecimiento»;
// design D7 de `object-store`). La aplica el barrido diario del `worker`, no una regla del almacén: el modo de
// comprobación del aprovisionamiento exige que no quede ninguno de más de 31 días, un día de margen sobre este plazo.

/** Días que se guarda un snapshot. El barrido borra los que tienen **más** de este plazo. */
export const SNAPSHOT_RETENTION_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * `true` si el snapshot escrito en `lastModified` tiene más de 30 días en `now`. Justo 30 días no basta: la spec
 * habla de «más de 30 días», y un snapshot de 30 días exactos todavía está dentro del plazo.
 */
export function isSnapshotExpired(lastModified: Date, now: Date): boolean {
  return (
    now.getTime() - lastModified.getTime() > SNAPSHOT_RETENTION_DAYS * DAY_MS
  );
}
