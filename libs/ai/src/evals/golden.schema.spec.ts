import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { executionKey } from '../application/execution-key';
import {
  classifySkillsTask,
  type ClassifySkillsInput,
  type ClassifySkillsOutput,
} from '../tasks/classify-skills.task';
import type { EvaluableTask } from './evaluable-task';
import {
  formatGoldenIssues,
  loadGolden,
  parseGolden,
  type GoldenIssue,
  type GoldenLoadResult,
} from './golden.schema';

// Tarea 1.4 (specs/ai/eval-harness, requisito "Golden set por tarea"; D4 de ai-eval-harness).

const evaluable: EvaluableTask<
  ClassifySkillsInput,
  ClassifySkillsOutput,
  { skills: string[] }
> = {
  task: classifySkillsTask,
  expectedSchema: z.object({ skills: z.array(z.string().min(1)) }),
  metrics: [],
};

function jsonl(...lines: unknown[]): string {
  return `${lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n')}\n`;
}

function caseLine(
  id: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    input: { text },
    expected: { skills: ['TypeScript'] },
    tags: ['placeholder'],
    ...extra,
  };
}

function issuesOf<I, E>(
  result: GoldenLoadResult<I, E>,
): readonly GoldenIssue[] {
  if (result.ok) throw new Error('expected an invalid golden set');
  return result.issues;
}

describe('golden set loader', () => {
  let evalsDir: string;

  beforeEach(async () => {
    evalsDir = await mkdtemp(join(tmpdir(), 'lv-golden-'));
  });

  afterEach(async () => {
    await rm(evalsDir, { recursive: true, force: true });
  });

  it('Golden set válido', async () => {
    await mkdir(join(evalsDir, 'classify-skills'));
    await writeFile(
      join(evalsDir, 'classify-skills', 'golden.jsonl'),
      jsonl(
        caseLine('es-01', 'Backend con TypeScript'),
        caseLine('en-01', 'Backend with TypeScript', { outputLanguage: 'en' }),
        caseLine('es-02', 'Frontend con Angular', { tags: [] }),
        caseLine('es-03', 'Datos con Python'),
        caseLine('en-02', 'Backend con TypeScript', { outputLanguage: 'en' }),
      ),
    );

    const result = await loadGolden(evaluable, evalsDir);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cases.map((c) => c.id)).toEqual([
      'es-01',
      'en-01',
      'es-02',
      'es-03',
      'en-02',
    ]);
    expect(new Set(result.cases.map((c) => c.key)).size).toBe(5);
    const [first, second] = result.cases;
    expect(first).toEqual({
      line: 1,
      id: 'es-01',
      input: { text: 'Backend con TypeScript' },
      expected: { skills: ['TypeScript'] },
      tags: ['placeholder'],
      key: executionKey({
        taskName: 'classify-skills',
        promptVersion: 'v1',
        outputLanguage: 'es',
        input: { text: 'Backend con TypeScript' },
      }),
    });
    expect(second?.outputLanguage).toBe('en');
  });

  it('Caso con input inválido', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(caseLine('es-01', 'TypeScript'), caseLine('es-02', '')),
      ),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 2, id: 'es-02' });
    expect(issues[0]?.message).toContain('invalid input');
    expect(issues[0]?.message).toContain('text');
  });

  it('Casos con la misma clave de ejecución', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(
          caseLine('es-01', 'TypeScript'),
          caseLine('en-01', 'TypeScript', { outputLanguage: 'en' }),
          caseLine('es-02', 'TypeScript', { outputLanguage: 'es' }),
        ),
      ),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 3, id: 'es-02' });
    expect(issues[0]?.message).toContain('"es-01"');
    expect(formatGoldenIssues('classify-skills', issues)).toMatch(
      /line 3, id "es-02": same execution key as case "es-01"/,
    );
  });

  it('rejects a malformed JSON line naming the line', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(caseLine('es-01', 'TypeScript'), '{"id": "es-02",'),
      ),
    );

    expect(issues).toEqual([{ line: 2, message: 'line is not valid JSON' }]);
  });

  it('rejects a duplicated id naming both lines', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(caseLine('es-01', 'TypeScript'), caseLine('es-01', 'Python')),
      ),
    );

    expect(issues).toEqual([
      {
        line: 2,
        id: 'es-01',
        message: 'duplicated id (first seen on line 1)',
      },
    ]);
  });

  it('rejects an invalid expected naming the line and the id', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(caseLine('es-01', 'TypeScript', { expected: { skills: 'TS' } })),
      ),
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ line: 1, id: 'es-01' });
    expect(issues[0]?.message).toContain('invalid expected');
  });

  it('rejects a line with missing fields or unknown keys', () => {
    const issues = issuesOf(
      parseGolden(
        evaluable,
        jsonl(
          {
            id: 'es-01',
            input: { text: 'TypeScript' },
            expected: { skills: [] },
          },
          caseLine('es-02', 'Python', { outputLanguaje: 'en' }),
        ),
      ),
    );

    expect(issues.map(({ line, id }) => ({ line, id }))).toEqual([
      { line: 1, id: 'es-01' },
      { line: 2, id: 'es-02' },
    ]);
  });

  it('reports every issue at once, ignores blank lines and accepts CRLF', () => {
    const content = jsonl(
      caseLine('es-01', 'TypeScript'),
      '',
      '   ',
      caseLine('es-02', ''),
      'not json',
    ).replace(/\n/g, '\r\n');

    const issues = issuesOf(parseGolden(evaluable, content));

    expect(issues.map((issue) => issue.line)).toEqual([4, 5]);
  });

  it('rejects an empty or missing golden set', async () => {
    expect(issuesOf(parseGolden(evaluable, '\n'))).toEqual([
      { message: 'golden set has no cases' },
    ]);
    const missing = issuesOf(await loadGolden(evaluable, evalsDir));
    expect(missing[0]?.message).toContain('golden set not readable');
  });
});
