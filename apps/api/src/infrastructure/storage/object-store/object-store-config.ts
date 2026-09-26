import { z } from 'zod';
import { s3ConfigShape } from '../../config/api-config.schema';

// Configuración del script `object-store` (design D4 de `object-store`): **solo** las `S3_*`. No importa `AppModule`
// ni valida el resto del esquema de `api`, así que `docker compose run … api node object-store.js` no arranca Nest
// aunque herede el entorno del servicio. Las cinco de `api` más el bucket de snapshots, que `api` no usa pero el
// aprovisionamiento sí (en producción el servicio `api` ya lo recibe).

export const objectStoreConfigSchema = z
  .object({
    ...s3ConfigShape,
    // Bucket de snapshots del `worker`. S3 exige de 3 a 63 caracteres.
    S3_SNAPSHOTS_BUCKET: z.string().min(3).max(63),
  })
  .superRefine((config, ctx) => {
    // Con los dos buckets iguales, `verify` pediría la antigüedad de los snapshots a los CV y el barrido del `worker`
    // los borraría: el mismo motivo por el que el barrido se niega a arrancar (design D7).
    if (config.S3_SNAPSHOTS_BUCKET === config.S3_BUCKET) {
      ctx.addIssue({
        code: 'custom',
        path: ['S3_SNAPSHOTS_BUCKET'],
        message: 'S3_SNAPSHOTS_BUCKET must differ from S3_BUCKET',
      });
    }
  });

export type ObjectStoreConfig = z.output<typeof objectStoreConfigSchema>;
