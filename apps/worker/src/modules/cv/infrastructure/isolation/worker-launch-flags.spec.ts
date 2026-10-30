import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { WORKSPACE_ROOT } from './isolation-test-paths';

// Guardia de las líneas de arranque (1.10, D7, N1, C3-01, C3-06): todo Node del contenedor del worker arranca sin el
// depurador por señal, y `nx serve worker` sin el inspector abierto.

function read(relative: string): string {
  return readFileSync(join(WORKSPACE_ROOT, relative), 'utf8');
}

/** Líneas de la etapa `runner` del Dockerfile (las posteriores al último `FROM … AS runner`). */
function runnerStage(): string[] {
  const lines = read('docker/worker.Dockerfile').split(/\r?\n/);
  let start = -1;
  lines.forEach((line, index) => {
    if (/^FROM\s+.*\s+AS\s+runner\s*$/i.test(line)) {
      start = index;
    }
  });
  expect(start, 'the runner stage exists').toBeGreaterThanOrEqual(0);
  return lines.slice(start + 1);
}

describe('worker launch flags', () => {
  it('the worker image starts node with --disable-sigusr1', () => {
    const cmd = runnerStage().find((line) => /^CMD\s/.test(line));

    expect(cmd).toBeDefined();
    const argv: unknown = JSON.parse((cmd ?? '').replace(/^CMD\s+/, ''));
    expect(argv).toEqual(['node', '--disable-sigusr1', 'main.js']);
  });

  it('the worker image sets NODE_OPTIONS=--disable-sigusr1 in the runner stage', () => {
    const env = runnerStage().filter((line) =>
      /^ENV\s+NODE_OPTIONS[= ]/.test(line),
    );

    expect(env).toEqual(['ENV NODE_OPTIONS=--disable-sigusr1']);
  });

  it('the prod compose does not override NODE_OPTIONS for the worker', () => {
    const compose = parse(read('docker-compose.prod.yml')) as {
      services: Record<
        string,
        {
          environment?: Record<string, unknown> | string[];
          env_file?: unknown;
          command?: unknown;
        }
      >;
    };
    const worker = compose.services['worker'];

    expect(worker).toBeDefined();
    const environment = worker?.environment ?? {};
    const names = Array.isArray(environment)
      ? environment.map((entry) => entry.split('=')[0])
      : Object.keys(environment);
    expect(names).not.toContain('NODE_OPTIONS');
    expect(worker?.env_file).toBeUndefined();
    // El `command` tampoco se sobrescribe: manda el `CMD` de la imagen.
    expect(worker?.command).toBeUndefined();
  });

  it('nx serve worker passes --disable-sigusr1', () => {
    const project = JSON.parse(read('apps/worker/project.json')) as {
      targets: { serve: { options: { runtimeArgs?: string[] } } };
    };

    expect(project.targets.serve.options.runtimeArgs).toEqual([
      '--disable-sigusr1',
    ]);
  });

  it('nx serve worker does not open the inspector', () => {
    const project = JSON.parse(read('apps/worker/project.json')) as {
      targets: { serve: { options: { inspect?: unknown } } };
    };

    expect(project.targets.serve.options.inspect).toBe(false);
  });
});
