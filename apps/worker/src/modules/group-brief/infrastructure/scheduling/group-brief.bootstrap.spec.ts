import { Logger } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComputeGroupWeeklyBriefs } from '../../application/compute-group-weekly-briefs.usecase';
import { GROUP_BRIEF_CLOCK } from '../../application/ports/group-brief.ports';
import {
  GROUP_BRIEF_ENSURE_INDEXES,
  GroupBriefBootstrap,
  type GroupBriefEnsureIndexes,
} from './group-brief.bootstrap';
import { GroupBriefScheduler } from './group-brief.scheduler';

let app: TestingModule | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  vi.restoreAllMocks();
});

async function compile(
  ensureIndexes: GroupBriefEnsureIndexes,
  execute: () => Promise<unknown>,
): Promise<{ app: TestingModule; scheduler: GroupBriefScheduler }> {
  const module = await Test.createTestingModule({
    providers: [
      GroupBriefBootstrap,
      GroupBriefScheduler,
      { provide: GROUP_BRIEF_ENSURE_INDEXES, useValue: ensureIndexes },
      { provide: GROUP_BRIEF_CLOCK, useValue: { now: () => new Date() } },
      { provide: ComputeGroupWeeklyBriefs, useValue: { execute } },
    ],
  }).compile();
  app = module;
  return { app: module, scheduler: module.get(GroupBriefScheduler) };
}

describe('GroupBriefBootstrap', () => {
  it('app init resolves while the boot tick hangs', async () => {
    const { app: module } = await compile(
      () => Promise.resolve(true),
      () => new Promise<never>(() => undefined),
    );
    const started = Date.now();
    await module.init();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('indexes are ensured before the boot tick', async () => {
    const calls: string[] = [];
    const { app: module } = await compile(
      async () => {
        await Promise.resolve();
        calls.push('indexes');
        return true;
      },
      () => {
        calls.push('tick');
        return Promise.resolve();
      },
    );
    await module.init();
    await vi.waitFor(() => expect(calls).toEqual(['indexes', 'tick']));
  });

  it('index failure disables the brief without failing boot', async () => {
    const execute = vi.fn(() => Promise.resolve());
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const { app: module, scheduler } = await compile(
      () => Promise.reject(new Error('index build failed')),
      execute,
    );
    await expect(module.init()).resolves.toBeDefined();
    await scheduler.tick();
    expect(execute).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  it('indexes reported as not ready also disable the brief', async () => {
    const execute = vi.fn(() => Promise.resolve());
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { app: module, scheduler } = await compile(
      () => Promise.resolve(false),
      execute,
    );
    await module.init();
    await scheduler.tick();
    expect(execute).not.toHaveBeenCalled();
  });
});
