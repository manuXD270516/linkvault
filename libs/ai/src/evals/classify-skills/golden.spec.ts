import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { classifySkillsEvaluable } from '../evaluable-tasks';
import { goldenPath, loadGolden } from '../golden.schema';
import { normalizeSkillName } from './metrics';

// Tarea 5.1: golden set real de `classify-skills` (D4 de ai-eval-harness; escenario "Golden set válido").

const EVALS_DIR = join(import.meta.dirname, '..');

async function realGolden() {
  const golden = await loadGolden(classifySkillsEvaluable, EVALS_DIR);
  if (!golden.ok) {
    throw new Error(
      `invalid golden: ${golden.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return golden.cases;
}

describe('classify-skills golden set', () => {
  it('Golden set válido', async () => {
    const cases = await realGolden();

    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(new Set(cases.map((c) => c.key)).size).toBe(cases.length);
  });

  it('has synthetic placeholder cases in Spanish and English with a matching output language', async () => {
    const cases = await realGolden();

    for (const goldenCase of cases) {
      expect(goldenCase.tags).toContain('placeholder');
      expect(goldenCase.tags).toContain(goldenCase.outputLanguage);
      expect(goldenCase.input.text.length).toBeGreaterThanOrEqual(400);
      expect(goldenCase.input.text.length).toBeLessThanOrEqual(1200);
      expect(goldenCase.input.text).toMatch(/^Empresa \d+\b/);
    }
    expect(cases.filter((c) => c.outputLanguage === 'es')).toHaveLength(3);
    expect(cases.filter((c) => c.outputLanguage === 'en')).toHaveLength(2);
  });

  it('expects only skills that appear in the text', async () => {
    for (const { id, input, expected } of await realGolden()) {
      const text = input.text.toLowerCase();
      const absent = expected.skills.filter(
        (skill) => !text.includes(normalizeSkillName(skill)),
      );
      expect(absent, id).toEqual([]);
    }
  });

  it('uses only reserved contact values', async () => {
    const raw = await readFile(
      goldenPath(EVALS_DIR, 'classify-skills'),
      'utf8',
    );

    for (const email of raw.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? []) {
      expect(email).toMatch(/@example\.com$/);
    }
    for (const url of raw.match(/https?:\/\/[^\s"/]+/g) ?? []) {
      expect(url).toMatch(/\.example$/);
    }
    for (const phone of raw.match(/\+?\d[\d\s-]{6,}\d/g) ?? []) {
      expect(phone).toMatch(/^\+591 7000000\d$/);
    }
  });
});
