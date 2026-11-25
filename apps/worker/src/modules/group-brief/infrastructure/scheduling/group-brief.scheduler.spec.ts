import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComputeGroupWeeklyBriefs } from '../../application/compute-group-weekly-briefs.usecase';
import { GroupBriefScheduler } from './group-brief.scheduler';

const NOW = new Date('2026-11-25T05:00:00.000Z');

function schedulerWith(execute: () => Promise<unknown>): {
  scheduler: GroupBriefScheduler;
  execute: ReturnType<typeof vi.fn>;
} {
  const fn = vi.fn(execute);
  const scheduler = new GroupBriefScheduler(
    { execute: fn } as unknown as ComputeGroupWeeklyBriefs,
    { now: () => NOW },
  );
  return { scheduler, execute: fn };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GroupBriefScheduler', () => {
  it('overlapping tick is skipped', async () => {
    let release: () => void = () => undefined;
    const { scheduler, execute } = schedulerWith(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const first = scheduler.tick();
    await scheduler.tick();
    expect(execute).toHaveBeenCalledTimes(1);
    release();
    await first;
    const third = scheduler.tick();
    release();
    await third;
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('tick error is logged and swallowed', async () => {
    const { scheduler } = schedulerWith(() =>
      Promise.reject(new Error('boom')),
    );
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('a tick after a failed one runs again', async () => {
    const { scheduler, execute } = schedulerWith(() =>
      Promise.reject(new Error('boom')),
    );
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await scheduler.tick();
    await scheduler.tick();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
