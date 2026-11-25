import { Global, Module } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppConfigModule } from '../../infrastructure/config/app-config.module';
import type { WorkerConfig } from '../../infrastructure/config/worker-config.schema';
import { workerTestConfig } from '../../test-support/test-config';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupBriefModule } from './group-brief.module';
import { GROUP_BRIEF_CRON } from './infrastructure/scheduling/group-brief.scheduler';
import { GROUP_WEEKLY_BRIEF_MODEL_NAME } from './infrastructure/persistence/group-weekly-brief.schemas';

// Sin Redis: las colas y los workers de notifications son dobles.
vi.mock('bullmq', () => {
  class Queue {
    add = vi.fn(() => Promise.resolve());
    close = vi.fn(() => Promise.resolve());
    on = vi.fn();
  }
  class Worker {
    on = vi.fn();
    close = vi.fn(() => Promise.resolve());
  }
  return { Queue, Worker };
});

/** Conexión de Mongo de mentira: los índices "se crean" y nada más se toca al arrancar. */
const fakeConnection = {
  models: {
    [GROUP_WEEKLY_BRIEF_MODEL_NAME]: { init: () => Promise.resolve() },
  },
  collection: () => ({}),
};

@Global()
@Module({
  providers: [{ provide: getConnectionToken(), useValue: fakeConnection }],
  exports: [getConnectionToken()],
})
class FakeMongoModule {}

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function compile(
  config: WorkerConfig,
  withDigest = false,
): Promise<string[]> {
  app = await Test.createTestingModule({
    imports: [
      AppConfigModule.forRoot(config),
      FakeMongoModule,
      ...(withDigest ? [NotificationsModule.register(config)] : []),
      GroupBriefModule.register(config),
    ],
  }).compile();
  await app.init();
  try {
    const registry = app.get(SchedulerRegistry, { strict: false });
    return [...registry.getCronJobs().values()].map((job) =>
      String(job.cronTime.source),
    );
  } catch {
    // Sin ScheduleModule no hay registro: tampoco hay crons.
    return [];
  }
}

describe('GroupBriefModule', () => {
  it('registers no cron in test', async () => {
    const config = await workerTestConfig({ FEATURE_GROUP_BRIEF: true });
    expect(await compile(config)).toEqual([]);
  });

  it('registers no cron when disabled', async () => {
    const config = await workerTestConfig({
      NODE_ENV: 'development',
      FEATURE_GROUP_BRIEF: false,
    });
    expect(await compile(config)).toEqual([]);
  });

  it('registers the daily cron when enabled outside test', async () => {
    const config = await workerTestConfig({
      NODE_ENV: 'development',
      FEATURE_GROUP_BRIEF: true,
    });
    expect(await compile(config)).toEqual([GROUP_BRIEF_CRON]);
  });

  it('digest and brief crons are both registered once', async () => {
    const config = await workerTestConfig({
      NODE_ENV: 'development',
      FEATURE_GROUP_BRIEF: true,
      FEATURE_GROUP_DIGEST: true,
    });
    const sources = await compile(config, true);
    expect(sources.filter((s) => s === GROUP_BRIEF_CRON)).toHaveLength(1);
    expect(sources.filter((s) => s === config.GROUP_DIGEST_CRON)).toHaveLength(
      1,
    );
  });
});
