import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DetectLinkFreshness } from '../../application/detect-link-freshness.usecase';

/**
 * Cron del detector de frescura. Solo se registra fuera de `test`.
 */
@Injectable()
export class LinkFreshnessScheduler {
  private readonly logger = new Logger(LinkFreshnessScheduler.name);

  constructor(private readonly detect: DetectLinkFreshness) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      const result = await this.detect.execute();
      const total =
        result.cascade + result.calendar + result.enqueued + result.deferred;
      if (total > 0) {
        this.logger.log(
          `Freshness tick: cascade=${result.cascade} calendar=${result.calendar} enqueued=${result.enqueued} deferred=${result.deferred}`,
        );
      }
    } catch (error: unknown) {
      this.logger.warn(
        `Freshness detector failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }
}
