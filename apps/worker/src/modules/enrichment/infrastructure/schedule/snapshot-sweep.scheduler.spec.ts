import { type DynamicModule, Logger, Module } from '@nestjs/common';
import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { workerTestConfig } from '../../../../test-support/test-config';
import {
  SweepExpiredSnapshots,
  type SnapshotSweepResult,
} from '../../application/sweep-expired-snapshots.usecase';
import { EnrichmentModule } from '../../enrichment.module';
import {
  SNAPSHOT_SWEEP_CRON,
  SNAPSHOT_SWEEP_JOB,
  SnapshotSweepScheduler,
} from './snapshot-sweep.scheduler';

// Programación diaria del barrido de snapshots (tarea 8.6 de `object-store`, design D7): el trabajo queda registrado
// con la expresión diaria y, al dispararlo, llama al caso de uso de la 8.5.

const SWEPT: SnapshotSweepResult = {
  status: 'swept',
  listed: 0,
  expired: 0,
  deleted: 0,
  alreadyGone: 0,
  failed: 0,
};

/** Módulo vacío en el lugar del de IA: construir la definición no instancia nada. */
@Module({})
class NoAiModule {}

const noAi: DynamicModule = { module: NoAiModule };

let moduleRef: TestingModule | undefined;

afterEach(async () => {
  await moduleRef?.close();
  moduleRef = undefined;
  vi.restoreAllMocks();
});

async function scheduledWith(
  execute: () => Promise<SnapshotSweepResult>,
): Promise<TestingModule> {
  moduleRef = await Test.createTestingModule({
    imports: [ScheduleModule.forRoot()],
    providers: [
      SnapshotSweepScheduler,
      { provide: SweepExpiredSnapshots, useValue: { execute } },
    ],
  }).compile();
  await moduleRef.init();
  return moduleRef;
}

describe('SnapshotSweepScheduler', () => {
  it('is registered by EnrichmentModule outside tests, like the other worker crons', async () => {
    const tokensOf = async (nodeEnv: 'production' | 'test') =>
      (
        EnrichmentModule.register(
          await workerTestConfig({ NODE_ENV: nodeEnv }),
          noAi,
        ).providers ?? []
      ).map((provider) =>
        typeof provider === 'object' && 'provide' in provider
          ? provider.provide
          : provider,
      );

    expect(await tokensOf('production')).toContain(SnapshotSweepScheduler);
    expect(await tokensOf('production')).toContain(SweepExpiredSnapshots);
    expect(await tokensOf('test')).not.toContain(SnapshotSweepScheduler);
  });

  it('registers a daily job that calls the sweep use case when it fires', async () => {
    const execute = vi.fn(() => Promise.resolve(SWEPT));
    const ref = await scheduledWith(execute);

    const job = ref.get(SchedulerRegistry).getCronJob(SNAPSHOT_SWEEP_JOB);

    expect(SNAPSHOT_SWEEP_CRON).toBe('0 0 * * *');
    expect(job.cronTime.source).toBe(SNAPSHOT_SWEEP_CRON);
    expect(job.cronTime.timeZone).toBe('UTC');
    expect(job.isActive).toBe(true);
    // Una vez al día: dos disparos seguidos están a 24 horas.
    const [first, second] = job.cronTime.sendAt(2);
    expect(second?.diff(first ?? second, 'hours').hours).toBe(24);
    expect(execute).not.toHaveBeenCalled();

    await job.fireOnTick();

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('logs a failed sweep without letting the error escape the job', async () => {
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const failure = new Error('connect ECONNREFUSED 10.0.0.5:9000');
    failure.name = 'TimeoutError';
    const ref = await scheduledWith(() => Promise.reject(failure));

    await ref
      .get(SchedulerRegistry)
      .getCronJob(SNAPSHOT_SWEEP_JOB)
      .fireOnTick();

    expect(warn).toHaveBeenCalledWith('Snapshot sweep failed: TimeoutError');
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('10.0.0.5');
  });
});
