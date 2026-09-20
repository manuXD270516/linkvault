import { describe, expect, it } from 'vitest';
import {
  ApplicationFitScores,
  type ApplicationFitScoreSource,
  type LinkFitScore,
} from './application-fit-scores';

// Registro de puntuaciones derivadas (tarea 12.2 de cv-match-suggestions).

const USER = '66e9a00000000000000000a1';
const LINK_A = '66e9a0000000000000000001';
const LINK_B = '66e9a0000000000000000002';

class StubSource implements ApplicationFitScoreSource {
  readonly calls: { userId: string; linkIds: readonly string[] }[] = [];

  constructor(
    private readonly scores: ReadonlyMap<string, LinkFitScore> = new Map(),
  ) {}

  scoresFor(
    userId: string,
    linkIds: readonly string[],
  ): Promise<ReadonlyMap<string, LinkFitScore>> {
    this.calls.push({ userId, linkIds });
    const filtered = new Map<string, LinkFitScore>();
    for (const linkId of linkIds) {
      const score = this.scores.get(linkId);
      if (score !== undefined) {
        filtered.set(linkId, score);
      }
    }
    return Promise.resolve(filtered);
  }
}

describe('ApplicationFitScores', () => {
  it('returns no scores by default', async () => {
    const registry = new ApplicationFitScores();

    expect(registry.registered).toBe(false);
    await expect(registry.scoresFor(USER, [LINK_A, LINK_B])).resolves.toEqual(
      new Map(),
    );
  });

  it('short-circuits an empty link set without calling the source', async () => {
    const registry = new ApplicationFitScores();
    const source = new StubSource(
      new Map([[LINK_A, { score: 78, degraded: false }]]),
    );
    registry.register(source);

    await expect(registry.scoresFor(USER, [])).resolves.toEqual(new Map());
    expect(source.calls).toEqual([]);
  });

  it('delegates a batch query to the registered source', async () => {
    const registry = new ApplicationFitScores();
    const source = new StubSource(
      new Map([
        [LINK_A, { score: 78, degraded: false }],
        [LINK_B, { score: 41, degraded: true }],
      ]),
    );
    registry.register(source);

    const scores = await registry.scoresFor(USER, [LINK_A, LINK_B]);

    expect(registry.registered).toBe(true);
    expect(source.calls).toEqual([{ userId: USER, linkIds: [LINK_A, LINK_B] }]);
    expect(scores.get(LINK_A)).toEqual({ score: 78, degraded: false });
    expect(scores.get(LINK_B)).toEqual({ score: 41, degraded: true });
  });
});
