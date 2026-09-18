import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EVALS_DIR,
  DEFAULT_REPORTS_DIR,
  EXIT_CODES,
  parseEvalArgs,
  parseRecordFixturesArgs,
} from './args';

// Tarea 3.5: parseo de argumentos y códigos de salida (D2 y D6 de ai-eval-harness).

function message(result: { ok: boolean; message?: string }): string {
  if (result.ok) throw new Error('expected a usage error');
  return result.message ?? '';
}

describe('exit codes', () => {
  it('matches D6', () => {
    expect(EXIT_CODES).toEqual({
      success: 0,
      regression: 1,
      usage: 2,
      programming: 3,
    });
  });
});

describe('parseEvalArgs', () => {
  it('parses a task with defaults', () => {
    expect(
      parseEvalArgs(['--task=classify-skills', '--provider=mock']),
    ).toEqual({
      ok: true,
      args: {
        task: 'classify-skills',
        all: false,
        provider: 'mock',
        updateBaseline: false,
        allowExternal: false,
        evalsDir: DEFAULT_EVALS_DIR,
        reportsDir: DEFAULT_REPORTS_DIR,
      },
    });
  });

  it('parses every flag in both --flag=value and --flag value forms', () => {
    expect(
      parseEvalArgs([
        '--all',
        '--provider',
        'ollama',
        '--allow-external=true',
        '--ollama-url',
        'http://127.0.0.1:11435',
        '--timeout-ms=300000',
        '--evals-dir',
        '/tmp/evals',
        '--reports-dir=/tmp/reports',
      ]),
    ).toEqual({
      ok: true,
      args: {
        all: true,
        provider: 'ollama',
        updateBaseline: false,
        allowExternal: true,
        ollamaUrl: 'http://127.0.0.1:11435',
        timeoutMs: 300_000,
        evalsDir: '/tmp/evals',
        reportsDir: '/tmp/reports',
      },
    });
  });

  it('accepts --update-baseline with the mock and --flag=false', () => {
    const result = parseEvalArgs([
      '--all',
      '--provider=mock',
      '--update-baseline',
      '--allow-external=false',
    ]);
    expect(result).toMatchObject({
      ok: true,
      args: { updateBaseline: true, allowExternal: false },
    });
  });

  it.each([
    [['--provider=mock'], 'either --task or --all is required'],
    [['--task=a', '--all', '--provider=mock'], 'cannot be combined'],
    [['--task=a'], '--provider is required'],
    [['--task=a', '--provider=anthropic'], '--provider must be one of'],
    [
      ['--task=a', '--provider=ollama', '--update-baseline'],
      'only allowed with --provider=mock',
    ],
    [['--task=a', '--provider=mock', '--timeout-ms=0'], 'positive integer'],
    [['--task=a', '--provider=mock', '--timeout-ms=1.5'], 'positive integer'],
    [['--task=a', '--provider=mock', '--verbose'], 'unknown flag --verbose'],
    [['--task=a', '--task=b', '--provider=mock'], 'more than once'],
    [['--task', '--provider=mock'], '--task requires a value'],
    [['--all=yes', '--provider=mock'], '--all takes no value'],
    [['classify-skills', '--provider=mock'], 'unexpected argument'],
    [['--task=a', '--provider=mock', '{args}'], 'unexpected argument'],
  ])('rejects %j', (argv, expected) => {
    const text = message(parseEvalArgs(argv));
    expect(text).toContain(expected);
    expect(text).toContain('Usage: nx run ai:eval');
  });
});

describe('parseRecordFixturesArgs', () => {
  it('parses the recording flags with defaults', () => {
    expect(
      parseRecordFixturesArgs([
        '--task=classify-skills',
        '--upstream=ollama',
        '--overwrite',
        '--ollama-url=http://127.0.0.1:11434',
        '--timeout-ms=300000',
      ]),
    ).toEqual({
      ok: true,
      args: {
        task: 'classify-skills',
        fromPending: false,
        upstream: 'ollama',
        overwrite: true,
        allowExternal: false,
        ollamaUrl: 'http://127.0.0.1:11434',
        timeoutMs: 300_000,
        evalsDir: DEFAULT_EVALS_DIR,
      },
    });
  });

  it('acepta --from-pending sin --task, con su registro', () => {
    expect(
      parseRecordFixturesArgs([
        '--from-pending',
        '--pending-file=tmp/pendientes.jsonl',
        '--upstream=ollama',
      ]),
    ).toEqual({
      ok: true,
      args: {
        fromPending: true,
        pendingFile: 'tmp/pendientes.jsonl',
        upstream: 'ollama',
        overwrite: false,
        allowExternal: false,
        evalsDir: DEFAULT_EVALS_DIR,
      },
    });
  });

  it('acepta --from-pending filtrado por tarea', () => {
    expect(
      parseRecordFixturesArgs([
        '--from-pending',
        '--task=extract-job',
        '--upstream=ollama',
      ]),
    ).toMatchObject({
      ok: true,
      args: { fromPending: true, task: 'extract-job' },
    });
  });

  it.each([
    [['--upstream=ollama'], '--task is required unless --from-pending'],
    [
      ['--task=a', '--upstream=ollama', '--pending-file=x'],
      '--pending-file requires --from-pending',
    ],
    [['--task=a'], '--upstream is required'],
    [['--task=a', '--upstream=mock'], '--upstream must be one of'],
    [['--task=a', '--upstream=ollama', '--reports-dir=x'], 'unknown flag'],
    [['--task=a', '--upstream=ollama', '--timeout-ms=-1'], 'positive integer'],
  ])('rejects %j', (argv, expected) => {
    const text = message(parseRecordFixturesArgs(argv));
    expect(text).toContain(expected);
    expect(text).toContain('Usage: nx run ai:record-fixtures');
  });
});
