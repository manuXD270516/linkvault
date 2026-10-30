// Plazos de arranque y de gracia de la lectura aislada (D2 de cv-extract-isolation). Viven en `application/` porque el
// caso de uso los suma a su plazo exterior; la infraestructura los reexporta junto a los demás topes
// (`infrastructure/isolation/extraction-limits.ts`).

/** Desde el `spawn` del proceso hijo hasta su mensaje `ready`. Vencido, es un fallo de maquinaria. */
export const CV_CHILD_BOOT_TIMEOUT_MS = 5_000;

/** Holgura para que el adaptador mate al hijo y espere su `exit` antes de que la red exterior corte. */
export const CV_ISOLATION_GRACE_MS = 2_000;
