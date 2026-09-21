import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GOLDEN_FILE_NAME } from '../golden.schema';
import { fileSha256 } from '../export/feedback-candidates';
import { runExportFeedbackCommand } from './export-feedback-candidates-command';

// Tarea 4.3: CLI de export; los golden no cambian.

describe('runExportFeedbackCommand', () => {
  let root: string;
  let evalsDir: string;
  let stdout: string[];
  let stderr: string[];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-export-fb-'));
    evalsDir = join(root, 'evals');
    stdout = [];
    stderr = [];
    for (const task of ['match-cv', 'critique-suggestions']) {
      await mkdir(join(evalsDir, task), { recursive: true });
      await writeFile(
        join(evalsDir, task, GOLDEN_FILE_NAME),
        `{"id":"${task}-guard"}\n`,
        'utf8',
      );
    }
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('exports from JSON and leaves guarded goldens unchanged', async () => {
    const matchGolden = join(evalsDir, 'match-cv', GOLDEN_FILE_NAME);
    const critiqueGolden = join(
      evalsDir,
      'critique-suggestions',
      GOLDEN_FILE_NAME,
    );
    const beforeMatch = await fileSha256(matchGolden);
    const beforeCritique = await fileSha256(critiqueGolden);

    const jsonPath = join(root, 'feedback.json');
    await writeFile(
      jsonPath,
      JSON.stringify([
        {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
          userId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
          analysisId: 'cccccccccccccccccccccccc',
          suggestionIndex: 1,
          afterHash: 'hash1',
          createdAt: '2026-09-21T10:00:00.000Z',
        },
      ]),
      'utf8',
    );

    const out = join(evalsDir, 'match-cv', 'candidates.jsonl');
    const code = await runExportFeedbackCommand(
      [
        `--from-json=${jsonPath}`,
        `--evals-dir=${evalsDir}`,
        `--out=${out}`,
      ],
      {
        env: {},
        cwd: root,
        stdout: (c) => {
          stdout.push(c);
        },
        stderr: (c) => {
          stderr.push(c);
        },
      },
    );

    expect(code).toBe(0);
    expect(stderr.join('')).toBe('');
    expect(stdout.join('')).toContain('wrote 1 candidate');
    expect(await readFile(out, 'utf8')).toContain('"source":"ai_feedback"');
    expect(await fileSha256(matchGolden)).toBe(beforeMatch);
    expect(await fileSha256(critiqueGolden)).toBe(beforeCritique);
  });
});
