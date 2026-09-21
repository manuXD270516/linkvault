import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CANDIDATES_FILE_NAME,
  candidatesPath,
  feedbackDocsToCandidateLines,
  fileSha256,
  hashGuardedGoldens,
  serializeCandidatesJsonl,
  writeCandidatesJsonl,
} from './feedback-candidates';
import { GOLDEN_FILE_NAME } from '../golden.schema';

// Tarea 4.3: export a candidates.jsonl sin tocar golden.

const SAMPLE_DOCS = [
  {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    analysisId: 'cccccccccccccccccccccccc',
    suggestionIndex: 0,
    afterHash: 'abc123',
    createdAt: new Date('2026-09-21T12:00:00.000Z'),
  },
  {
    id: 'dddddddddddddddddddddddd',
    userId: { toString: () => 'eeeeeeeeeeeeeeeeeeeeeeee' },
    analysisId: { toString: () => 'ffffffffffffffffffffffff' },
    suggestionIndex: 2,
    afterHash: 'def456',
    createdAt: '2026-09-21T13:00:00.000Z',
  },
] as const;

describe('feedbackDocsToCandidateLines', () => {
  it('maps feedback docs to candidate lines without suggestion text', () => {
    const lines = feedbackDocsToCandidateLines([...SAMPLE_DOCS]);
    expect(lines).toEqual([
      {
        source: 'ai_feedback',
        id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
        userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
        analysisId: 'cccccccccccccccccccccccc',
        suggestionIndex: 0,
        afterHash: 'abc123',
        createdAt: '2026-09-21T12:00:00.000Z',
      },
      {
        source: 'ai_feedback',
        id: 'dddddddddddddddddddddddd',
        userId: 'eeeeeeeeeeeeeeeeeeeeeeee',
        analysisId: 'ffffffffffffffffffffffff',
        suggestionIndex: 2,
        afterHash: 'def456',
        createdAt: '2026-09-21T13:00:00.000Z',
      },
    ]);
    const serialized = serializeCandidatesJsonl(lines);
    expect(serialized).not.toContain('after":');
    expect(serialized).not.toContain('cvFragment');
  });
});

describe('writeCandidatesJsonl does not touch goldens', () => {
  let evalsDir: string;

  beforeEach(async () => {
    evalsDir = await mkdtemp(join(tmpdir(), 'lv-candidates-'));
    for (const task of ['match-cv', 'critique-suggestions']) {
      await mkdir(join(evalsDir, task), { recursive: true });
      await writeFile(
        join(evalsDir, task, GOLDEN_FILE_NAME),
        `{"id":"${task}-01"}\n`,
        'utf8',
      );
    }
  });

  afterEach(async () => {
    await rm(evalsDir, { recursive: true, force: true });
  });

  it('writes only candidates.jsonl and leaves golden hashes unchanged', async () => {
    const before = await hashGuardedGoldens(evalsDir);
    const out = candidatesPath(evalsDir);
    const lines = feedbackDocsToCandidateLines([...SAMPLE_DOCS]);

    await writeCandidatesJsonl(out, lines);

    const after = await hashGuardedGoldens(evalsDir);
    expect(after.get('match-cv')).toBe(before.get('match-cv'));
    expect(after.get('critique-suggestions')).toBe(
      before.get('critique-suggestions'),
    );
    expect(after.get('match-cv')).not.toBeNull();

    const written = await readFile(out, 'utf8');
    expect(out.endsWith(CANDIDATES_FILE_NAME)).toBe(true);
    expect(written).toBe(serializeCandidatesJsonl(lines));
    expect(await fileSha256(join(evalsDir, 'match-cv', GOLDEN_FILE_NAME))).toBe(
      before.get('match-cv'),
    );
  });

  it('refuses to write to a golden.jsonl path', async () => {
    await expect(
      writeCandidatesJsonl(
        join(evalsDir, 'match-cv', GOLDEN_FILE_NAME),
        feedbackDocsToCandidateLines([...SAMPLE_DOCS]),
      ),
    ).rejects.toThrow(/golden/u);
  });
});
