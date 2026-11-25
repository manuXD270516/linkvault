import { Inject, Injectable, Logger } from '@nestjs/common';
import { ComputeGroupWeeklyBriefs } from '../../application/compute-group-weekly-briefs.usecase';
import {
  GROUP_BRIEF_CLOCK,
  type GroupBriefClock,
} from '../../application/ports/group-brief.ports';

/** Cron UTC del tick diario (design D2): constante en código, no variable de entorno. */
export const GROUP_BRIEF_CRON = '0 5 * * *';

/**
 * Cuerpo del tick (cron diario y arranque). Nunca relanza: captura y registra cualquier error, y un guardia en
 * memoria evita dos ticks solapados del mismo proceso.
 */
@Injectable()
export class GroupBriefScheduler {
  private readonly logger = new Logger(GroupBriefScheduler.name);
  private running = false;
  private disabled = false;

  constructor(
    private readonly computeBriefs: ComputeGroupWeeklyBriefs,
    @Inject(GROUP_BRIEF_CLOCK) private readonly clock: GroupBriefClock,
  ) {}

  /** Apaga el cron y el tick de arranque (N2: no se pudieron crear los índices). */
  disable(): void {
    this.disabled = true;
  }

  async tick(): Promise<void> {
    if (this.disabled) {
      return;
    }
    if (this.running) {
      this.logger.warn('group_brief_tick_skipped reason=overlap');
      return;
    }
    this.running = true;
    try {
      await this.computeBriefs.execute(this.clock.now());
    } catch (error: unknown) {
      this.logger.error(
        `group_brief_tick_failed error=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
