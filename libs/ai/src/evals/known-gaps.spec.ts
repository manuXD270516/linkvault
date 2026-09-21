import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  crossCheckKnownGaps,
  KNOWN_GAPS_FILE_NAME,
  loadKnownGaps,
  parseKnownGaps,
} from './known-gaps';
import type { GoldenCase } from './evaluable-task';

// Tareas 6.6–6.8: declaración de huecos conocidos fuera del golden.

describe('known-gaps declaration', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-known-gaps-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it.each([
    {
      name: 'entrada completa',
      raw: JSON.stringify({
        'bare-id-without-keyword': {
          type: 'id',
          reason: 'detector conservador',
          decision: 'ADR-030',
        },
      }),
      ok: true,
    },
    {
      name: 'sin motivo',
      raw: JSON.stringify({
        gap: { type: 'id', reason: '', decision: 'ADR-030' },
      }),
      ok: false,
      missing: 'reason',
    },
    {
      name: 'sin referencia',
      raw: JSON.stringify({
        gap: { type: 'id', reason: 'x', decision: '' },
      }),
      ok: false,
      missing: 'decision',
    },
  ])('Hueco conocido sin decisión que lo respalde: $name', ({ raw, ok, missing }) => {
    const result = parseKnownGaps(raw);
    expect(result.ok).toBe(ok);
    if (!ok && !result.ok) {
      expect(result.issues.some((i) => i.message.includes(missing ?? ''))).toBe(
        true,
      );
    }
  });

  it('archivo ausente', async () => {
    const result = await loadKnownGaps(root, 'match-cv');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.message).toContain(KNOWN_GAPS_FILE_NAME);
  });

  it('Marca de hueco conocido sin declarar', () => {
    const cases = [
      {
        line: 2,
        id: 'c1',
        input: {},
        expected: {},
        tags: [],
        key: 'k',
        pii: [
          {
            type: 'id' as const,
            value: '8765432',
            knownGap: 'not-declared',
          },
        ],
      },
    ] satisfies GoldenCase<unknown, unknown>[];
    const cross = crossCheckKnownGaps(cases, {
      other: { type: 'id', reason: 'r', decision: 'd' },
    });
    expect(cross.issues[0]).toMatchObject({ line: 2, id: 'c1' });
    expect(cross.issues[0]?.message).toContain('not-declared');
    expect(cross.issues[0]?.message).not.toContain('8765432');
  });

  it('Hueco declarado que ya no usa ningún caso', () => {
    const cross = crossCheckKnownGaps([], {
      stale: { type: 'id', reason: 'r', decision: 'ADR-030' },
    });
    expect(cross.issues).toEqual([]);
    expect(cross.unused).toEqual(['stale']);
  });

  it('El corredor no puede silenciar una fuga por su cuenta', async () => {
    const taskDir = join(root, 'match-cv');
    await mkdir(taskDir, { recursive: true });
    const path = join(taskDir, KNOWN_GAPS_FILE_NAME);
    const body = `${JSON.stringify(
      {
        'bare-id-without-keyword': {
          type: 'id',
          reason: 'conservador',
          decision: 'ADR-030',
        },
      },
      null,
      2,
    )}\n`;
    await writeFile(path, body);
    const before = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');

    // Simula que el corredor solo lee: no hay API de escritura de known-gaps.
    const loaded = await loadKnownGaps(root, 'match-cv');
    expect(loaded.ok).toBe(true);

    const after = createHash('sha256')
      .update(await readFile(path))
      .digest('hex');
    expect(after).toBe(before);
    expect(await readFile(path, 'utf8')).toBe(body);
  });
});
