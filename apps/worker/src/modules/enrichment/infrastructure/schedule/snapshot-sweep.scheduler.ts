import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SweepExpiredSnapshots } from '../../application/sweep-expired-snapshots.usecase';

// Programación diaria del barrido de snapshots (design D7 de `object-store`). Como los demás cron del `worker`, solo se
// registra fuera de `test`, y `ScheduleModule.forRoot()` lo pone `NotificationsModule` con la misma condición. Cada
// réplica dispara el suyo: el caso de uso tolera dos barridos a la vez.

/** Nombre del trabajo en el `SchedulerRegistry`. */
export const SNAPSHOT_SWEEP_JOB = 'snapshot-sweep';

/** Una vez al día, a medianoche UTC. */
export const SNAPSHOT_SWEEP_CRON = CronExpression.EVERY_DAY_AT_MIDNIGHT;

@Injectable()
export class SnapshotSweepScheduler {
  private readonly logger = new Logger(SnapshotSweepScheduler.name);

  constructor(
    @Inject(SweepExpiredSnapshots)
    private readonly sweep: SweepExpiredSnapshots,
  ) {}

  @Cron(SNAPSHOT_SWEEP_CRON, { name: SNAPSHOT_SWEEP_JOB, timeZone: 'UTC' })
  async tick(): Promise<void> {
    try {
      await this.sweep.execute();
    } catch (error: unknown) {
      // Solo el tipo de error: el mensaje del SDK puede llevar el endpoint o la clave del objeto.
      this.logger.warn(
        `Snapshot sweep failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    }
  }
}
