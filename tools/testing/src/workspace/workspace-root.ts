import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Raíz del workspace (la carpeta con `nx.json`), buscada hacia arriba desde el directorio de trabajo del test. */
export function workspaceRoot(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'nx.json'))) {
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('workspaceRoot: nx.json not found above the test cwd');
    }
    dir = parent;
  }
  return dir;
}
