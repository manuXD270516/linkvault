import { describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import type { CvLimitKey } from '../application/ports/cv-limiter.port';
import {
  CV_LIMIT_WINDOW_MS,
  CV_REJECTS_PER_USER,
  CV_TEXT_PREVIEWS_PER_USER,
  CV_UPLOADS_PER_USER,
} from '../domain/limits';
import { CounterCvLimiter } from './counter-cv-limiter';

// Política de fallo y nombres de las tres claves de `cv` (D5). Es lo único que este adaptador decide, así que se
// prueba sin Redis: el contador es un doble.

/** Contador que responde lo que se le diga, y anota con qué clave y qué límite se le preguntó. */
class CounterDouble implements FixedWindowCounter {
  readonly asked: { key: string; limit: WindowLimit }[] = [];
  readonly givenBack: string[] = [];

  constructor(private readonly outcome: AttemptOutcome | null) {}

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    this.asked.push({ key, limit });
    return Promise.resolve(this.outcome);
  }

  reset(): Promise<boolean> {
    return Promise.resolve(true);
  }

  giveBack(key: string): Promise<boolean> {
    this.givenBack.push(key);
    return Promise.resolve(true);
  }
}

const ALLOWED: AttemptOutcome = { allowed: true, retryAfterSeconds: 0 };
const EXHAUSTED: AttemptOutcome = { allowed: false, retryAfterSeconds: 742 };
const USER_ID = '66e9a0000000000000000a01';

const keys: readonly CvLimitKey[] = [
  { kind: 'upload', userId: USER_ID },
  { kind: 'text-preview', userId: USER_ID },
  { kind: 'reject', userId: USER_ID },
];

describe('CounterCvLimiter', () => {
  it.each(keys.map((key) => [key.kind, key] as const))(
    'lets %s through when the counter does not answer',
    async (_kind, key) => {
      const limiter = new CounterCvLimiter(new CounterDouble(null));

      await expect(limiter.consume(key)).resolves.toEqual({
        allowed: true,
        retryAfterSeconds: 0,
      });
    },
  );

  it.each(keys.map((key) => [key.kind, key] as const))(
    'refuses %s with its wait when the window is spent',
    async (_kind, key) => {
      const limiter = new CounterCvLimiter(new CounterDouble(EXHAUSTED));

      await expect(limiter.consume(key)).resolves.toEqual({
        allowed: false,
        retryAfterSeconds: 742,
      });
    },
  );

  it('asks each key by its own name and its own limit', async () => {
    const counter = new CounterDouble(ALLOWED);
    const limiter = new CounterCvLimiter(counter);

    for (const key of keys) {
      await limiter.consume(key);
    }

    expect(counter.asked).toEqual([
      {
        key: `cv:upload:${USER_ID}`,
        limit: { limit: CV_UPLOADS_PER_USER, windowMs: CV_LIMIT_WINDOW_MS },
      },
      {
        key: `cv:text-preview:${USER_ID}`,
        limit: {
          limit: CV_TEXT_PREVIEWS_PER_USER,
          windowMs: CV_LIMIT_WINDOW_MS,
        },
      },
      {
        key: `cv:reject:${USER_ID}`,
        limit: { limit: CV_REJECTS_PER_USER, windowMs: CV_LIMIT_WINDOW_MS },
      },
    ]);
    // Tres nombres distintos: agotar uno no cierra los otros.
    expect(new Set(counter.asked.map((call) => call.key)).size).toBe(3);
  });

  it('gives an upload attempt back', async () => {
    const counter = new CounterDouble(ALLOWED);

    await new CounterCvLimiter(counter).refund({
      kind: 'upload',
      userId: USER_ID,
    });

    expect(counter.givenBack).toEqual([`cv:upload:${USER_ID}`]);
  });

  it('does not offer a refund for a rejection: a rejection did happen', () => {
    const limiter = new CounterCvLimiter(new CounterDouble(ALLOWED));
    // El tipo de `refund` solo admite la clave de subidas; esto lo afirma en tiempo de ejecución además del compilador.
    const refundable: Parameters<CounterCvLimiter['refund']>[0] = {
      kind: 'upload',
      userId: USER_ID,
    };

    expect(refundable.kind).toBe('upload');
    expect(limiter.refund).toBeInstanceOf(Function);
  });

  it('does not throw when the counter cannot give the attempt back', async () => {
    const counter = new CounterDouble(null);

    await expect(
      new CounterCvLimiter(counter).refund({ kind: 'upload', userId: USER_ID }),
    ).resolves.toBeUndefined();
  });
});
