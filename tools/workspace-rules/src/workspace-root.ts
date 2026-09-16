import { resolve } from 'node:path';

/** Raíz del monorepo: las pruebas de reglas instancian ESLint con la configuración real desde aquí. */
export const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
