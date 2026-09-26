// Qué modo rige el almacén de objetos (design D7 de `object-store`, ADR-052 §7). Es una **constante** y no una
// variable de entorno: el producto de almacén es el mismo en desarrollo, CI y producción, y un modo distinto por
// entorno sería verificar una configuración y desplegar otra. Lo leen el script `object-store` de `api`, las fábricas
// de cliente S3 y el `worker`.

/**
 * Cifrado en reposo del bucket de CV:
 * - `server`: cifrado por defecto del bucket, con la clave del servidor (`OBJECT_STORE_SSE_KEY`). `provision` lo pone y
 *   `verify` lo comprueba.
 * - `customer-key`: SSE-C, la clave la envía la aplicación en cada petición (`S3_CV_SSE_C_KEY`); no se comprueba por
 *   bucket.
 */
export const CV_BUCKET_ENCRYPTION_MODES = ['server', 'customer-key'] as const;
export type CvBucketEncryptionMode =
  (typeof CV_BUCKET_ENCRYPTION_MODES)[number];

/**
 * Modo vigente. **Valor inicial `server`, pendiente de la matriz**: lo fija la tarea 6.2 de `object-store` con el
 * veredicto de `docs/object-store-matrix/matriz.md`.
 */
export const CV_BUCKET_ENCRYPTION_MODE: CvBucketEncryptionMode = 'server';

/**
 * Retención de snapshots de enriquecimiento. `sweep` es su **único** valor (decisión del usuario, 2026-09-26): la
 * borra el barrido diario del `worker`, y el almacén no lleva ninguna regla de ciclo de vida (`provision` quita la que
 * haya y `verify` falla si encuentra una). Una regla del almacén exigiría medir su expiración en un change posterior.
 */
export const SNAPSHOT_RETENTION_MODES = ['sweep'] as const;
export type SnapshotRetentionMode = (typeof SNAPSHOT_RETENTION_MODES)[number];

export const SNAPSHOT_RETENTION_MODE: SnapshotRetentionMode = 'sweep';
