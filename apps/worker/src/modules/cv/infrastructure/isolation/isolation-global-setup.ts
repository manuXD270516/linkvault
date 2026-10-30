import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TestProject } from 'vitest/node';
import {
  CHILD_TEST_OUT_DIR,
  CHILD_TEST_SCRIPT,
  WORKSPACE_ROOT,
} from './isolation-test-paths';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Lo que el proyecto `worker-isolation` quedó configurado a ser (lo lee `isolation-project.spec.ts`). */
    isolationProjectConfig: {
      readonly name: string;
      readonly fileParallelism: boolean | undefined;
      readonly pool: string | undefined;
      readonly execArgv: readonly string[];
    };
  }
}

// `globalSetup` del proyecto `worker-isolation` (N7): compila solo el script del hijo y lo que importa, con un
// `tsconfig` propio, a `tmp/cv-child-test/`. El directorio se vacía antes: solo contiene la salida de `tsc`.
export default function setup(project: TestProject): void {
  project.provide('isolationProjectConfig', {
    name: project.name,
    // El valor declarado, no el resuelto: `--maxWorkers` o `VITEST_MAX_WORKERS` cambian el resuelto sin tocar esto.
    fileParallelism: project.vite.config.test?.fileParallelism,
    pool: project.config.pool,
    execArgv: project.config.execArgv,
  });

  rmSync(CHILD_TEST_OUT_DIR, { recursive: true, force: true });
  mkdirSync(CHILD_TEST_OUT_DIR, { recursive: true });
  const tsc = join(WORKSPACE_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(
    process.execPath,
    [
      tsc,
      '-p',
      join(WORKSPACE_ROOT, 'apps', 'worker', 'tsconfig.cv-child-test.json'),
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0 || !existsSync(CHILD_TEST_SCRIPT)) {
    throw new Error(
      `cannot compile the test child (tsc exit ${String(result.status)}): ${result.stdout}${result.stderr}`,
    );
  }
}
