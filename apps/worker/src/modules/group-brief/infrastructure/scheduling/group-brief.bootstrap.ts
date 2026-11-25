import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { GroupBriefScheduler } from './group-brief.scheduler';

/** Asegura los índices y devuelve `false` si no pudo (el módulo queda apagado hasta el próximo arranque). */
export const GROUP_BRIEF_ENSURE_INDEXES = Symbol('GROUP_BRIEF_ENSURE_INDEXES');
export type GroupBriefEnsureIndexes = () => Promise<boolean>;

/**
 * Arranque del módulo (design D2, H2, H3, N2): primero espera a que existan los índices y después dispara el tick
 * sin esperarlo. El arranque del worker nunca espera al tick ni falla por él ni por los índices.
 */
@Injectable()
export class GroupBriefBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(GroupBriefBootstrap.name);

  constructor(
    @Inject(GROUP_BRIEF_ENSURE_INDEXES)
    private readonly ensureIndexes: GroupBriefEnsureIndexes,
    private readonly scheduler: GroupBriefScheduler,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    let ready = false;
    try {
      ready = await this.ensureIndexes();
    } catch (error: unknown) {
      this.logger.error(
        `group_brief_indexes_failed error=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
    if (!ready) {
      this.logger.error('group_brief_disabled reason=indexes');
      this.scheduler.disable();
      return;
    }
    void this.scheduler.tick().catch((error: unknown) => {
      this.logger.error(
        `group_brief_boot_tick_failed error=${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    });
  }
}
