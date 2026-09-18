import { describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { CounterLinkLimiter } from './counter-link-limiter';
import {
  ENRICH_RETRIES_PER_LINK,
  IMPORTS_PER_USER,
  LINK_LIMIT_WINDOW_MS,
} from '../domain/limits';

// Política de fallo de los dos límites de `links` (tarea 6.4 y D13). Es lo único que este adaptador decide y es
// deliberadamente distinta en cada uno, así que se prueba sin Redis: el contador es un doble.

/** Contador que responde lo que se le diga, y anota con qué límite se le preguntó. */
class CounterDouble implements FixedWindowCounter {
  readonly asked: { key: string; limit: WindowLimit }[] = [];

  constructor(private readonly outcome: AttemptOutcome | null) {}

  consume(key: string, limit: WindowLimit): Promise<AttemptOutcome | null> {
    this.asked.push({ key, limit });
    return Promise.resolve(this.outcome);
  }

  reset(): Promise<boolean> {
    return Promise.resolve(true);
  }

  giveBack(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

const ALLOWED: AttemptOutcome = { allowed: true, retryAfterSeconds: 0 };
const LINK_ID = '000000000000000000000007';
const USER_ID = '000000000000000000000001';

describe('CounterLinkLimiter', () => {
  it('El contador no responde: la importación sigue adelante', async () => {
    const limiter = new CounterLinkLimiter(new CounterDouble(null));

    expect(await limiter.consume({ kind: 'import', userId: USER_ID })).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('a retry is refused when the counter does not answer, because it would download from someone else', async () => {
    const limiter = new CounterLinkLimiter(new CounterDouble(null));

    const decision = await limiter.consume({
      kind: 'enrich-link',
      linkId: LINK_ID,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBe(LINK_LIMIT_WINDOW_MS / 1000);
  });

  it('answers what the counter said when it does answer', async () => {
    const counter = new CounterDouble(ALLOWED);
    const limiter = new CounterLinkLimiter(counter);

    await limiter.consume({ kind: 'enrich-link', linkId: LINK_ID });
    await limiter.consume({ kind: 'import', userId: USER_ID });

    expect(counter.asked).toEqual([
      {
        key: `links:enrich:${LINK_ID}`,
        limit: {
          limit: ENRICH_RETRIES_PER_LINK,
          windowMs: LINK_LIMIT_WINDOW_MS,
        },
      },
      {
        key: `links:import:${USER_ID}`,
        limit: { limit: IMPORTS_PER_USER, windowMs: LINK_LIMIT_WINDOW_MS },
      },
    ]);
  });

  it('never names the url of the user in the counter key', async () => {
    const counter = new CounterDouble(ALLOWED);

    await new CounterLinkLimiter(counter).consume({
      kind: 'enrich-link',
      linkId: LINK_ID,
    });

    expect(counter.asked[0]?.key).not.toMatch(/https?:/);
  });
});
