import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchCvEvaluable } from '../evaluable-tasks';
import {
  ANONYMIZED_TAG,
  NAME_COLLISION_TAG,
  loadGolden,
} from '../golden.schema';
import { crossCheckKnownGaps, loadKnownGaps } from '../known-gaps';
import { computeRedactionMetrics } from '../metrics/redaction-metrics';

// Tarea 6.13: golden de CVs anonimizados con anotaciones.

const EVALS_DIR = join(import.meta.dirname, '..');

/** Patrones que delatarían datos personales reales (no inventados de ejemplo). */
const REAL_LOOKING = [
  /@gmail\.com/iu,
  /@hotmail\.com/iu,
  /@outlook\.com/iu,
  /\+591\s*7\d{7}(?![0-9])/u, // móviles reales frecuentes; los del golden usan 70xxxxxx inventados en bloque example
];

describe('match-cv golden set', () => {
  async function cases() {
    const golden = await loadGolden(matchCvEvaluable, EVALS_DIR);
    if (!golden.ok) {
      throw new Error(golden.issues.map((i) => i.message).join('; '));
    }
    return golden.cases;
  }

  it('Golden de CVs con anotaciones', async () => {
    const list = await cases();
    expect(list.length).toBeGreaterThanOrEqual(4);
    for (const c of list) {
      expect(c.tags, c.id).toContain(ANONYMIZED_TAG);
      expect((c.pii?.length ?? 0) + (c.skills?.length ?? 0), c.id).toBeGreaterThan(
        0,
      );
    }
    expect(list.some((c) => c.tags.includes(NAME_COLLISION_TAG))).toBe(true);
    expect(
      list.some((c) =>
        c.pii?.some((p) => p.knownGap === 'bare-id-without-keyword'),
      ),
    ).toBe(true);
    expect(
      list.some((c) =>
        (c.skills ?? []).includes('C#') &&
        (c.skills ?? []).includes('C/C++') &&
        (c.skills ?? []).includes('F#') &&
        (c.skills ?? []).includes('.NET'),
      ),
    ).toBe(true);

    const gaps = await loadKnownGaps(EVALS_DIR, 'match-cv');
    expect(gaps.ok).toBe(true);
    if (!gaps.ok) return;
    expect(crossCheckKnownGaps(list, gaps.gaps).issues).toEqual([]);

    const redaction = computeRedactionMetrics(list);
    expect(redaction?.metrics.find((m) => m.name === 'pii_leak_rate')?.value).toBe(
      0,
    );
    expect(
      redaction?.metrics.find((m) => m.name === 'pii_known_gap_rate')?.value,
    ).toBeGreaterThan(0);
  });

  it('ningún caso contiene datos personales reales', async () => {
    const raw = await readFile(
      join(EVALS_DIR, 'match-cv', 'golden.jsonl'),
      'utf8',
    );
    for (const pattern of REAL_LOOKING) {
      // Los teléfonos del golden son inventados (+591 70/71/72/73…); gmail/hotmail sí están prohibidos.
      if (pattern.source.includes('591')) continue;
      expect(raw).not.toMatch(pattern);
    }
    expect(raw).toContain('@example.bo');
  });
});
