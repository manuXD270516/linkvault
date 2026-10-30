import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildChildCommand, developmentReadList } from './child-command';
import {
  CHILD_TEST_OUT_DIR,
  CHILD_TEST_SCRIPT,
  NODE_MODULES_ROOT,
  WORKSPACE_ROOT,
} from './isolation-test-paths';

// El hijo de los tests lee **solo su directorio de salida** (3.5, C3-04): con los flags de producción, un fichero de
// `tmp/` fuera de ese directorio da `ERR_ACCESS_DENIED`.

const outside = join(WORKSPACE_ROOT, 'tmp', `cvx-outside-${process.pid}.txt`);

afterAll(() => {
  rmSync(outside, { force: true });
});

describe('the test child read list', () => {
  it('the test child reads only its output directory', () => {
    mkdirSync(join(WORKSPACE_ROOT, 'tmp'), { recursive: true });
    writeFileSync(outside, 'outside');
    const command = buildChildCommand({
      script: CHILD_TEST_SCRIPT,
      allowRead: developmentReadList(CHILD_TEST_OUT_DIR, NODE_MODULES_ROOT),
      format: 'pdf',
    });
    // Los mismos flags, sin el script ni el formato: se ejecuta una expresión en su lugar.
    const flags = command.args.slice(0, -2);
    const probe = (path: string): string => {
      const result = spawnSync(
        process.execPath,
        [
          ...flags,
          '-p',
          `(() => { try { require('node:fs').readFileSync(${JSON.stringify(path)}); return 'READ_OK'; } catch (e) { return e.code; } })()`,
        ],
        { env: {}, encoding: 'utf8' },
      );
      return result.stdout.trim();
    };

    expect(probe(outside)).toBe('ERR_ACCESS_DENIED');
    expect(probe(CHILD_TEST_SCRIPT)).toBe('READ_OK');
  });
});
