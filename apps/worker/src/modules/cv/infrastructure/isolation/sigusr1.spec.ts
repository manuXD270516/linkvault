import { spawn } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { ChildScripts, runnerFor } from './isolation-test-kit';
import { WORKSPACE_ROOT } from './isolation-test-paths';

// Una señal del hijo no abre el depurador del worker ni el de un hermano (1.9, D7, N1, C3-01, C3-03). Solo Linux: en
// Windows `process.kill(pid, 'SIGUSR1')` no existe como señal.

const scripts = new ChildScripts();
afterAll(() => {
  scripts.dispose();
});

interface Report {
  readonly alive: boolean;
  readonly url: string | null;
  readonly debugPort: number;
  readonly connect: string;
}

const SIGNALLING_CHILD = `
  await ready();
  await readAll();
  process.kill(process.ppid, 'SIGUSR1');
  await text('signalled');
  hold();
`;

function runParent(
  nodeFlags: readonly string[],
  childScript: string,
  env: NodeJS.ProcessEnv = {},
): Promise<Report> {
  return new Promise((resolve, reject) => {
    const parent = spawn(
      process.execPath,
      [
        ...nodeFlags,
        '--import',
        'tsx',
        'apps/worker/src/modules/cv/infrastructure/isolation/sigusr1-parent.fixture.ts',
        childScript,
      ],
      {
        cwd: WORKSPACE_ROOT,
        env: { PATH: process.env['PATH'] ?? '', ...env },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let out = '';
    parent.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    parent.once('error', reject);
    parent.once('close', () => {
      try {
        resolve(JSON.parse(out.trim().split('\n').pop() ?? '') as Report);
      } catch {
        reject(new Error('the test parent published no report'));
      }
    });
  });
}

describe.runIf(process.platform === 'linux')('SIGUSR1 from the child', () => {
  it('a child SIGUSR1 does not open the worker inspector', async () => {
    const report = await runParent(
      ['--disable-sigusr1'],
      scripts.write(SIGNALLING_CHILD),
    );

    expect(report.alive).toBe(true);
    expect(report.url).toBeNull();
    // El puerto que el padre declara, no un 9229 fijo.
    expect(report.connect).toBe('ECONNREFUSED');
  }, 30_000);

  it('a child SIGUSR1 does not open a sibling inspector started with NODE_OPTIONS only', async () => {
    const sibling = spawn(
      process.execPath,
      [
        '-e',
        "setTimeout(() => { process.stdout.write(JSON.stringify({ url: require('inspector').url() ?? null }) + String.fromCharCode(10)); }, 2000);",
      ],
      {
        // Sin el flag en la línea de órdenes: solo `NODE_OPTIONS`, como el healthcheck `node -e` de la imagen.
        env: {
          PATH: process.env['PATH'] ?? '',
          NODE_OPTIONS: '--disable-sigusr1',
        },
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    let out = '';
    sibling.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    const closed = new Promise<number | null>((resolve) => {
      sibling.once('close', (code) => resolve(code));
    });
    const script = scripts.write(`
      await ready();
      const pid = Number((await readAll()).toString());
      process.kill(pid, 'SIGUSR1');
      await text('signalled');
      hold();
    `);
    const { runner } = runnerFor(scripts, script);
    await new Promise((resolve) => setTimeout(resolve, 300));

    await runner.run('pdf', new TextEncoder().encode(String(sibling.pid)));
    const code = await closed;

    expect(code).toBe(0);
    expect(JSON.parse(out.trim()) as { url: string | null }).toEqual({
      url: null,
    });
  }, 30_000);
});
