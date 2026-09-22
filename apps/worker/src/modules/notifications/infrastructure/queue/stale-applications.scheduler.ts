import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DetectStaleApplications } from '../../application/detect-stale-applications.usecase';

/**
 * Cron del detector stale. Solo se registra fuera de `test` (mismo criterio que otros consumers).
 */
@Injectable()
export class StaleApplicationsScheduler {
  private readonly logger = new Logger(StaleApplicationsScheduler.name);

  constructor(private readonly detect: DetectStaleApplications) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      const n = await this.detect.execute();
      if (n > 0) {
        this.logger.log(`Enqueued ${n} stale application notification(s)`);
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Stale detector failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}
