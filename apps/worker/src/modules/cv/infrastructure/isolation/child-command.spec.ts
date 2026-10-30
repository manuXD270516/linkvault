import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  buildChildCommand,
  developmentReadList,
  productionReadList,
} from './child-command';

const scratch = mkdtempSync(join(tmpdir(), 'cvx-command-'));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function realDirectory(name: string): string {
  const path = join(scratch, name);
  mkdirSync(path, { recursive: true });
  return realpathSync.native(path);
}

describe('buildChildCommand', () => {
  it('builds the child command line', () => {
    const script = realDirectory('script-dir');
    const modules = realDirectory('node-modules');

    const command = buildChildCommand({
      script,
      allowRead: [script, modules],
      format: 'pdf',
    });

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([
      '--permission',
      `--allow-fs-read=${script}`,
      `--allow-fs-read=${modules}`,
      '--max-old-space-size=256',
      '--max-semi-space-size=16',
      '--disallow-code-generation-from-strings',
      script,
      'pdf',
    ]);
  });

  it('one allow-fs-read flag per path', () => {
    const a = realDirectory('a');
    const b = realDirectory('b');
    const c = realDirectory('c');

    const { args } = buildChildCommand({
      script: a,
      allowRead: [a, b, c],
      format: 'docx',
    });

    const flags = args.filter((arg) => arg.startsWith('--allow-fs-read='));
    expect(flags).toEqual([a, b, c].map((path) => `--allow-fs-read=${path}`));
    expect(flags.some((flag) => flag.includes(','))).toBe(false);
  });

  it('allow-fs-read paths are real paths', () => {
    const target = realDirectory('real-modules');
    const link = join(scratch, 'linked-modules');
    // En Windows una unión (`junction`) no pide privilegios; en el resto es un enlace simbólico a un directorio.
    symlinkSync(target, link, 'junction');

    const { args } = buildChildCommand({
      script: target,
      allowRead: [link],
      format: 'pdf',
    });

    expect(args).toContain(`--allow-fs-read=${target}`);
    expect(args).not.toContain(`--allow-fs-read=${link}`);
  });

  it('the production read list is the one fixed in the design', () => {
    expect(productionReadList('/app')).toEqual([
      '/app/cv-extract-child.js',
      '/app/node_modules',
    ]);
  });

  it('the development read list is the script and the node_modules root', () => {
    expect(developmentReadList('/out/child', '/ws/node_modules')).toEqual([
      '/out/child',
      '/ws/node_modules',
    ]);
  });

  it('never grants write, child process, worker, addons or wasi', () => {
    const dir = realDirectory('perm');

    const { args } = buildChildCommand({
      script: dir,
      allowRead: [dir],
      format: 'pdf',
    });

    for (const forbidden of [
      '--allow-fs-write',
      '--allow-child-process',
      '--allow-worker',
      '--allow-addons',
      '--allow-wasi',
    ]) {
      expect(args.some((arg) => arg.startsWith(forbidden))).toBe(false);
    }
    expect(args).toContain('--permission');
    expect(args).toContain('--disallow-code-generation-from-strings');
  });

  it('the child gets an empty env', () => {
    const dir = realDirectory('env');

    const { options } = buildChildCommand({
      script: dir,
      allowRead: [dir],
      format: 'pdf',
    });

    expect(options.env).toEqual({});
    expect(options.stdio).toEqual(['pipe', 'ignore', 'ignore', 'pipe']);
    expect(options.detached).toBe(false);
  });
});
