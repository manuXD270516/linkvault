import { Logger } from '@nestjs/common';
import { isSnapshotExpired } from '../domain/snapshot-retention';
import type { Clock } from './ports/clock.port';
import {
  SNAPSHOT_DELETE_BATCH,
  type SnapshotBucket,
  type SnapshotDeletion,
} from './ports/snapshot-bucket.port';

// Barrido de snapshots de enriquecimiento (design D7 de `object-store`; spec `cv/documents`, «Retención de snapshots de
// enriquecimiento»). La retención de 30 días es este barrido y no una regla del almacén: lista el bucket de snapshots y
// borra, por lotes, lo que tiene más de 30 días según el reloj inyectado. Lo dispara a diario `SnapshotSweepScheduler`.
//
// - **Solo el bucket de snapshots.** Si `S3_SNAPSHOTS_BUCKET` es igual a `S3_BUCKET`, un barrido por antigüedad
//   borraría los CV de todo el mundo: se niega, no borra nada y lo registra.
// - **Varias réplicas a la vez.** Cada una lista y borra por su cuenta; lo que otra ya borró cuenta como éxito, y la
//   antigüedad se decide con la fecha del listado, así que ninguna borra un snapshot de 30 días o menos.
// - Un borrado que el almacén rechaza por otro motivo se cuenta y se avisa, y el barrido sigue: lo que quede lo recoge
//   el del día siguiente, y el modo de comprobación del aprovisionamiento falla si algo pasa de 31 días.

/** Los dos buckets de la configuración: el que se barre y el que nunca se puede barrer. */
export interface SnapshotSweepBuckets {
  /** `S3_SNAPSHOTS_BUCKET`. */
  readonly snapshotsBucket: string;
  /** `S3_BUCKET`, el de los CV. */
  readonly cvBucket: string;
}

export type SnapshotSweepResult =
  | {
      readonly status: 'refused';
      readonly reason: 'snapshots-bucket-is-cv-bucket';
    }
  | {
      readonly status: 'swept';
      readonly listed: number;
      readonly expired: number;
      readonly deleted: number;
      readonly alreadyGone: number;
      readonly failed: number;
    };

export class SweepExpiredSnapshots {
  private readonly logger = new Logger(SweepExpiredSnapshots.name);

  constructor(
    private readonly bucket: SnapshotBucket,
    private readonly clock: Clock,
    private readonly buckets: SnapshotSweepBuckets,
  ) {}

  async execute(): Promise<SnapshotSweepResult> {
    if (this.buckets.snapshotsBucket === this.buckets.cvBucket) {
      // Sin el nombre del bucket ni nada de lo que contiene: basta con decir qué variables coinciden.
      this.logger.error(
        'snapshot sweep refused: S3_SNAPSHOTS_BUCKET is the same bucket as S3_BUCKET (the CV bucket); nothing deleted',
      );
      return { status: 'refused', reason: 'snapshots-bucket-is-cv-bucket' };
    }

    const bucket = this.buckets.snapshotsBucket;
    const now = this.clock.now();
    let listed = 0;
    let expired = 0;
    const outcomes: SnapshotDeletion[] = [];
    let pageToken: string | null = null;

    do {
      const page = await this.bucket.listPage(bucket, pageToken);
      listed += page.objects.length;
      const keys = page.objects
        .filter((object) => isSnapshotExpired(object.lastModified, now))
        .map((object) => object.key);
      expired += keys.length;
      for (let start = 0; start < keys.length; start += SNAPSHOT_DELETE_BATCH) {
        outcomes.push(
          ...(await this.bucket.deleteMany(
            bucket,
            keys.slice(start, start + SNAPSHOT_DELETE_BATCH),
          )),
        );
      }
      pageToken = page.nextPageToken;
    } while (pageToken !== null);

    const deleted = outcomes.filter((o) => o.outcome === 'deleted').length;
    const alreadyGone = outcomes.filter(
      (o) => o.outcome === 'already-gone',
    ).length;
    const failures = outcomes.flatMap((o) =>
      o.outcome === 'failed' ? [o.code] : [],
    );

    if (failures.length > 0) {
      // Los códigos, sin las claves: el aviso es para ver que el almacén rechaza borrados, no qué links había.
      this.logger.warn(
        `snapshot sweep: ${failures.length} delete(s) rejected by the store (${[...new Set(failures)].sort().join(', ')})`,
      );
    }
    this.logger.log(
      `snapshot sweep: listed ${listed}, expired ${expired}, deleted ${deleted}, already gone ${alreadyGone}, failed ${failures.length}`,
    );
    return {
      status: 'swept',
      listed,
      expired,
      deleted,
      alreadyGone,
      failed: failures.length,
    };
  }
}
