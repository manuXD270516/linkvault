import { verifyGroupWeeklyBrief } from '@linkvault/shared';
import {
  type DynamicModule,
  Injectable,
  Module,
  type Provider,
  type Type,
} from '@nestjs/common';
import { Cron, ScheduleModule } from '@nestjs/schedule';
import { getConnectionToken } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { ComputeGroupWeeklyBriefs } from './application/compute-group-weekly-briefs.usecase';
import {
  GROUP_BRIEF_CATALOG,
  GROUP_BRIEF_CLOCK,
  GROUP_BRIEF_ENABLED,
  GROUP_BRIEF_STORE,
  GROUP_BRIEF_VERIFIER,
} from './application/ports/group-brief.ports';
import { MongoGroupBriefCatalog } from './infrastructure/persistence/mongo-group-brief.catalog';
import {
  MongoGroupBriefStore,
  ensureGroupBriefIndexes,
} from './infrastructure/persistence/mongo-group-brief.store';
import {
  GROUP_BRIEF_ENSURE_INDEXES,
  GroupBriefBootstrap,
} from './infrastructure/scheduling/group-brief.bootstrap';
import {
  GROUP_BRIEF_CRON,
  GroupBriefScheduler,
} from './infrastructure/scheduling/group-brief.scheduler';

class SystemClock {
  now(): Date {
    return new Date();
  }
}

/** Host del `@Cron` diario (05:00 UTC). El cuerpo vive en `GroupBriefScheduler`. */
function createGroupBriefCronHost(): Type<unknown> {
  @Injectable()
  class GroupBriefCronHost {
    constructor(private readonly scheduler: GroupBriefScheduler) {}

    @Cron(GROUP_BRIEF_CRON, { timeZone: 'UTC' })
    handle(): Promise<void> {
      return this.scheduler.tick();
    }
  }
  return GroupBriefCronHost;
}

/**
 * «La semana del grupo» en el worker (change group-weekly-brief). Con `NODE_ENV=test` o con
 * `FEATURE_GROUP_BRIEF=false` no registra nada: ni cron, ni tick de arranque, ni proveedores.
 */
@Module({})
export class GroupBriefModule {
  static register(config: WorkerConfig): DynamicModule {
    const active = config.NODE_ENV !== 'test' && config.FEATURE_GROUP_BRIEF;
    if (!active) {
      return { module: GroupBriefModule };
    }
    const providers: Provider[] = [
      { provide: GROUP_BRIEF_CLOCK, useClass: SystemClock },
      { provide: GROUP_BRIEF_ENABLED, useValue: true },
      { provide: GROUP_BRIEF_VERIFIER, useValue: verifyGroupWeeklyBrief },
      { provide: GROUP_BRIEF_CATALOG, useClass: MongoGroupBriefCatalog },
      { provide: GROUP_BRIEF_STORE, useClass: MongoGroupBriefStore },
      {
        provide: GROUP_BRIEF_ENSURE_INDEXES,
        useFactory: (connection: Connection) => () =>
          ensureGroupBriefIndexes(connection),
        inject: [getConnectionToken()],
      },
      ComputeGroupWeeklyBriefs,
      GroupBriefScheduler,
      GroupBriefBootstrap,
      createGroupBriefCronHost(),
    ];
    return {
      module: GroupBriefModule,
      imports: [ScheduleModule.forRoot()],
      providers,
    };
  }
}
