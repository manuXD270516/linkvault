import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './isolation-test-paths';

// El bundle del hijo no carga el worker (3.6, H6, D12): el fichero construido por `pnpm nx build worker`. El target
// `test` del worker depende de `build`, así que existe cuando se corre por Nx; a mano, `pnpm nx build worker` primero.

const DIST = join(WORKSPACE_ROOT, 'dist', 'apps', 'worker');
const BUNDLE = join(DIST, 'cv-extract-child.js');

function bundle(): string {
  expect(
    existsSync(BUNDLE),
    'dist/apps/worker/cv-extract-child.js is missing: run `pnpm nx build worker`',
  ).toBe(true);
  return readFileSync(BUNDLE, 'utf8');
}

describe('the built child bundle', () => {
  it('the child bundle does not import nestjs, pino or the worker config', () => {
    const source = bundle();

    expect(source).not.toMatch(/require\(["']@nestjs\//);
    expect(source).not.toMatch(/require\(["']nestjs-pino["']\)/);
    expect(source).not.toMatch(/require\(["']pino["']\)/);
    // El módulo de configuración del worker (su esquema o su cargador) tampoco entra.
    expect(source).not.toMatch(
      /WorkerConfig|worker-config\.schema|load-worker-config|APP_CONFIG/,
    );
  });

  it('dist package.json pins the parser libraries', () => {
    const manifest = JSON.parse(
      readFileSync(join(DIST, 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };

    for (const name of ['mammoth', 'pdf-parse']) {
      const version = manifest.dependencies[name];
      expect(version, `${name} is listed`).toBeDefined();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(version).not.toMatch(/[\^~]/);
    }
  });

  it('the child bundle is a single file', () => {
    const source = bundle();

    // Sin cargas relativas ni chunks de webpack: lo que permite que la lista de lecturas de producción tenga un solo
    // fichero (C3-04).
    expect(source).not.toMatch(/require\(["']\.\//);
    expect(source).not.toContain('__webpack_require__.e');
    expect(source).not.toContain('__webpack_require__.f');
  });
});
