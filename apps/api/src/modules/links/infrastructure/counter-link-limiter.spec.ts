import { describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
  WindowLimit,
} from '../../../infrastructure/limits/fixed-window-counter';
import { CounterLinkLimiter } from './counter-link-limiter';
import {
  COMMENTS_PER_USER,
  ENRICH_RETRIES_PER_LINK,
  IMPORTS_PER_USER,
  LINK_LIMIT_WINDOW_MS,
  PASTES_PER_USER,
  PUBLIC_PAGE_VIEWS,
  PUBLIC_PAGE_VIEWS_PER_SLUG,
  PUBLIC_PREVIEW_VIEWS,
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

  readonly givenBack: string[] = [];
  answersGiveBack = true;

  giveBack(key: string): Promise<boolean> {
    this.givenBack.push(key);
    return Promise.resolve(this.answersGiveBack);
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

  it('El contador no responde: a paste is refused, saying the counter is down and not that the window ran out', async () => {
    const limiter = new CounterLinkLimiter(new CounterDouble(null));

    const decision = await limiter.consume({
      kind: 'paste-description',
      userId: USER_ID,
    });

    expect(decision).toEqual({
      allowed: false,
      retryAfterSeconds: 60,
      unavailable: true,
    });
  });

  it('counts the pastes of a person with their own limit', async () => {
    const counter = new CounterDouble(ALLOWED);

    await new CounterLinkLimiter(counter).consume({
      kind: 'paste-description',
      userId: USER_ID,
    });

    expect(counter.asked).toEqual([
      {
        key: `links:paste:${USER_ID}`,
        limit: { limit: PASTES_PER_USER, windowMs: LINK_LIMIT_WINDOW_MS },
      },
    ]);
  });

  it('gives an attempt back on the same counter it was taken from', async () => {
    const counter = new CounterDouble(ALLOWED);

    await new CounterLinkLimiter(counter).refund({
      kind: 'paste-description',
      userId: USER_ID,
    });

    expect(counter.givenBack).toEqual([`links:paste:${USER_ID}`]);
  });

  it('a refund with the counter down does not throw: the attempt just stays spent', async () => {
    const counter = new CounterDouble(null);
    counter.answersGiveBack = false;

    await expect(
      new CounterLinkLimiter(counter).refund({
        kind: 'paste-description',
        userId: USER_ID,
      }),
    ).resolves.toBeUndefined();
  });

  describe('comments (D6 de group-comments)', () => {
    it('counts 30 comments per person in 15 minutes, under links:comment:<userId>', async () => {
      const counter = new CounterDouble(ALLOWED);
      const limiter = new CounterLinkLimiter(counter);

      expect(
        await limiter.consume({ kind: 'comment', userId: USER_ID }),
      ).toEqual(ALLOWED);
      expect(counter.asked).toEqual([
        {
          key: `links:comment:${USER_ID}`,
          limit: { limit: COMMENTS_PER_USER, windowMs: LINK_LIMIT_WINDOW_MS },
        },
      ]);
      expect(COMMENTS_PER_USER).toBe(30);
    });

    it('answers the exhausted window of the counter', async () => {
      const limiter = new CounterLinkLimiter(
        new CounterDouble({ allowed: false, retryAfterSeconds: 120 }),
      );

      expect(
        await limiter.consume({ kind: 'comment', userId: USER_ID }),
      ).toEqual({ allowed: false, retryAfterSeconds: 120 });
    });

    it('Contador caído: a comment goes ahead', async () => {
      const limiter = new CounterLinkLimiter(new CounterDouble(null));

      expect(
        await limiter.consume({ kind: 'comment', userId: USER_ID }),
      ).toEqual({ allowed: true, retryAfterSeconds: 0 });
    });

    it('gives an attempt back on the same key, also with the counter down', async () => {
      const counter = new CounterDouble(ALLOWED);
      counter.answersGiveBack = false;
      const limiter = new CounterLinkLimiter(counter);

      await expect(
        limiter.refund({ kind: 'comment', userId: USER_ID }),
      ).resolves.toBeUndefined();
      expect(counter.givenBack).toEqual([`links:comment:${USER_ID}`]);
    });
  });
});

// Contadores de las rutas públicas (tarea 6.8 de public-preview-share, D8). Son globales de ruta: ninguna clave lleva
// nada del cliente, así que no hay `trustProxy` que valga ni nada que falsificar.
describe('los contadores de las rutas públicas', () => {
  const SLUG = 'k7m2p9r4t6vw';

  it.each([
    [
      { kind: 'public-page' } as const,
      'links:public-page',
      PUBLIC_PAGE_VIEWS,
    ],
    [
      { kind: 'public-preview' } as const,
      'links:public-preview',
      PUBLIC_PREVIEW_VIEWS,
    ],
    [
      { kind: 'public-page-slug', slug: SLUG } as const,
      `links:public-page:${SLUG}`,
      PUBLIC_PAGE_VIEWS_PER_SLUG,
    ],
  ])('cuenta %j bajo %s', async (key, name, limit) => {
    const counter = new CounterDouble(ALLOWED);
    const limiter = new CounterLinkLimiter(counter);

    expect(await limiter.consume(key)).toEqual(ALLOWED);
    expect(counter.asked).toEqual([
      { key: name, limit: { limit, windowMs: LINK_LIMIT_WINDOW_MS } },
    ]);
  });

  it('el tope de un enlace está por debajo del global', () => {
    expect(PUBLIC_PAGE_VIEWS_PER_SLUG).toBeLessThan(PUBLIC_PAGE_VIEWS);
  });

  it.each([
    [{ kind: 'public-page' } as const],
    [{ kind: 'public-preview' } as const],
    [{ kind: 'public-page-slug', slug: SLUG } as const],
  ])('El contador no responde: %j pasa igual', async (key) => {
    const limiter = new CounterLinkLimiter(new CounterDouble(null));

    expect(await limiter.consume(key)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
  });

  it('responde la ventana agotada del contador', async () => {
    const limiter = new CounterLinkLimiter(
      new CounterDouble({ allowed: false, retryAfterSeconds: 300 }),
    );

    expect(await limiter.consume({ kind: 'public-page' })).toEqual({
      allowed: false,
      retryAfterSeconds: 300,
    });
  });

  it('devuelve el intento al contador global cuando el del enlace rechaza', async () => {
    const counter = new CounterDouble(ALLOWED);
    const limiter = new CounterLinkLimiter(counter);

    await limiter.refund({ kind: 'public-page' });

    expect(counter.givenBack).toEqual(['links:public-page']);
  });

  it('ninguna clave depende de una cabecera de la petición', () => {
    const counter = new CounterDouble(ALLOWED);
    const limiter = new CounterLinkLimiter(counter);

    return Promise.all([
      limiter.consume({ kind: 'public-page' }),
      limiter.consume({ kind: 'public-preview' }),
      limiter.consume({ kind: 'public-page-slug', slug: SLUG }),
    ]).then(() => {
      // Las claves solo pueden llevar lo que hay en la ruta: dos de ellas son constantes y la tercera, el slug.
      expect(counter.asked.map((entry) => entry.key)).toEqual([
        'links:public-page',
        'links:public-preview',
        `links:public-page:${SLUG}`,
      ]);
    });
  });
});
