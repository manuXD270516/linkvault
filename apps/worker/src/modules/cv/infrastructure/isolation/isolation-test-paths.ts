import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Rutas del hijo de los tests (D10, N7, C3-04): el hijo real se compila con `tsc` a `tmp/cv-child-test/`, sin
// `pnpm nx build worker`. Un fichero por módulo, así que al hijo se le concede el **directorio** de salida.

function findWorkspaceRoot(start: string): string {
  let current = start;
  for (;;) {
    if (existsSync(join(current, 'nx.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error('workspace root (nx.json) not found');
    }
    current = parent;
  }
}

export const WORKSPACE_ROOT = findWorkspaceRoot(import.meta.dirname);
export const CHILD_TEST_OUT_DIR = join(WORKSPACE_ROOT, 'tmp', 'cv-child-test');
/** Salida de `tsc` para `child/cv-extract.child.ts` con `rootDir` en `modules/cv`. */
export const CHILD_TEST_SCRIPT = join(
  CHILD_TEST_OUT_DIR,
  'infrastructure',
  'isolation',
  'child',
  'cv-extract.child.js',
);
export const NODE_MODULES_ROOT = realpathSync.native(
  join(WORKSPACE_ROOT, 'node_modules'),
);
