import {
  abortableSleep,
  isAbortError,
  jitteredDelay,
  raceAbort,
} from './refresh-coordination';

describe('refresh coordination helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('applies up to ±50 % jitter around the base delay', () => {
    expect(jitteredDelay(250, 0.5, 0)).toBe(125);
    expect(jitteredDelay(500, 0.5, 0.5)).toBe(500);
    expect(jitteredDelay(1000, 0.5, 0.999_999)).toBe(1500);
  });

  it('sleeps for the given time', async () => {
    vi.useFakeTimers();
    let done = false;
    const sleeping = abortableSleep(250).then(() => (done = true));

    await vi.advanceTimersByTimeAsync(249);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await sleeping;
    expect(done).toBe(true);
  });

  it('rejects the sleep with an AbortError when aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const sleeping = abortableSleep(1000, controller.signal);

    controller.abort();

    await expect(sleeping).rejects.toSatisfy(isAbortError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting on abort without cancelling the shared promise', async () => {
    const controller = new AbortController();
    let resolveShared: (value: string) => void = () => undefined;
    const shared = new Promise<string>((resolve) => (resolveShared = resolve));
    const joined = raceAbort(shared, controller.signal);

    controller.abort();
    resolveShared('ok');

    await expect(joined).rejects.toSatisfy(isAbortError);
    await expect(shared).resolves.toBe('ok');
  });
});
