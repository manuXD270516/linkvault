import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolve } from 'node:path';
import {
  classifySkillsEvaluable,
  extractPastedJobEvaluable,
  matchCvEvaluable,
} from '../evaluable-tasks';
import { eraseEvaluableTask } from '../evaluable-task';
import {
  auditPersonalFixtures,
  externalOriginIssue,
} from './audit-personal-fixtures';

// Tareas 6.16–6.17: auditoría de fixtures personales.

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../../../..');
const REAL_FIXTURES = join(
  WORKSPACE_ROOT,
  'libs/ai/src/infrastructure/fixtures',
);

describe('auditPersonalFixtures', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'lv-audit-fix-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('Un fixture personal grabado con la regla anterior', async () => {
    const dir = join(root, 'classify-skills');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'deadbeef.json'),
      JSON.stringify({
        source: 'recorded:openrouter:some-model',
        text: '{}',
        model: 'some-model',
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    );

    const audit = await auditPersonalFixtures(root, [
      eraseEvaluableTask(classifySkillsEvaluable),
    ]);
    expect(audit.issues.length).toBeGreaterThan(0);
    expect(audit.issues[0]?.task).toBe('classify-skills');
    expect(audit.issues[0]?.file).toBe('deadbeef.json');
    expect(audit.issues[0]?.message).toContain('openrouter');
  });

  it('Un fixture personal escrito a mano sigue valiendo', async () => {
    const audit = await auditPersonalFixtures(REAL_FIXTURES, [
      eraseEvaluableTask(classifySkillsEvaluable),
      eraseEvaluableTask(extractPastedJobEvaluable),
    ]);
    expect(audit.checked).toBe(14);
    expect(audit.issues).toEqual([]);
  });

  it('Un fixture personal con un dato personal dentro', async () => {
    const dir = join(root, 'match-cv');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'pii.json'),
      JSON.stringify({
        source: 'handwritten',
        text: JSON.stringify({
          score: 1,
          matchedSkills: [],
          missingSkills: [],
          suggestions: [
            {
              section: 'skills',
              after: 'Escribir a ana.perez@example.com',
              reason: 'x',
              evidence: {
                jobRequirement: 'x',
                importance: 'must',
                cvFragment: null,
              },
            },
          ],
        }),
        model: 'hand',
        usage: { inputTokens: 0, outputTokens: 0 },
      }),
    );

    const audit = await auditPersonalFixtures(root, [
      eraseEvaluableTask(matchCvEvaluable),
    ]);
    expect(audit.issues[0]?.message).toContain('email');
    expect(audit.issues[0]?.message).not.toContain('ana.perez');
  });

  it('externalOriginIssue acepta handwritten y ollama', () => {
    expect(
      externalOriginIssue('handwritten', {
        name: 'classify-skills',
        dataSensitivity: 'personal',
      }),
    ).toBeNull();
    expect(
      externalOriginIssue('recorded:ollama:qwen2.5:7b', {
        name: 'classify-skills',
        dataSensitivity: 'personal',
      }),
    ).toBeNull();
    expect(
      externalOriginIssue('recorded:openrouter:x', {
        name: 'match-cv',
        dataSensitivity: 'personal',
      }),
    ).toContain('openrouter');
  });
});
