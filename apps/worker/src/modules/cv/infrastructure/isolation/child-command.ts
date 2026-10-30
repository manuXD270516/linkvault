import { existsSync, realpathSync } from 'node:fs';
import { basename, dirname, join, posix, resolve } from 'node:path';
import type { SpawnOptions } from 'node:child_process';
import {
  CV_CHILD_MAX_OLD_SPACE_MB,
  CV_CHILD_MAX_SEMI_SPACE_MB,
} from './extraction-limits';

// Línea de órdenes del proceso hijo de lectura (D1 de cv-extract-isolation). Sin variables de entorno, con el modelo de
// permisos de Node (solo lectura de las rutas de la lista fijada), heap acotado y sin evaluación de código desde
// cadenas. **Nunca** se concede escritura, procesos, hilos, código nativo ni WASI.

export type CvFileFormat = 'pdf' | 'docx';

/** Raíz de la imagen (`WORKDIR /app` de `docker/worker.Dockerfile`). */
export const PRODUCTION_ROOT = '/app';

/**
 * Lista de lecturas de **producción** (N2): el script del hijo (un solo fichero, aserción de la 3.6) y la raíz de
 * `node_modules`. El `package.json` del ámbito del script **no** entra: la prueba de la 3.5 demostró que la sonda
 * pasa sin él (ver «Estado de las mediciones» del design).
 */
export function productionReadList(root: string = PRODUCTION_ROOT): string[] {
  // La imagen es Linux: rutas POSIX aunque la función se llame desde otro sistema.
  return [
    posix.join(root, 'cv-extract-child.js'),
    posix.join(root, 'node_modules'),
  ];
}

/**
 * Misma regla fuera de la imagen: el script (o el directorio de salida de `tsc`, en los tests) y la raíz de
 * `node_modules` donde se resuelven `pdf-parse` y `mammoth`.
 */
export function developmentReadList(
  scriptOrDirectory: string,
  nodeModulesRoot: string,
): string[] {
  return [scriptOrDirectory, nodeModulesRoot];
}

/**
 * Raíz de `node_modules` desde la que el hijo resuelve sus bibliotecas: el primer ancestro del directorio del script
 * que contiene `pdf-parse`. En la imagen es `/app/node_modules`; en desarrollo, la del workspace.
 */
export function resolveNodeModulesRoot(scriptDirectory: string): string {
  let current = resolve(scriptDirectory);
  for (;;) {
    const candidate = join(current, 'node_modules');
    if (existsSync(join(candidate, 'pdf-parse'))) {
      return candidate;
    }
    const parent = dirname(current);
    if (parent === current) {
      return join(resolve(scriptDirectory), 'node_modules');
    }
    current = parent;
  }
}

/** Dónde está el script del hijo y qué puede leer, a partir del directorio donde corre el bundle del worker. */
export function childLocationFor(bundleDirectory: string): {
  readonly scriptPath: string;
  readonly allowRead: string[];
} {
  const scriptPath = join(resolve(bundleDirectory), 'cv-extract-child.js');
  return {
    scriptPath,
    allowRead: developmentReadList(
      scriptPath,
      resolveNodeModulesRoot(bundleDirectory),
    ),
  };
}

/** Resuelve enlaces simbólicos (N3): el modelo de permisos compara contra la ruta real. */
export function realPathOf(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    // Una ruta que no existe (el script ausente) no se puede resolver; se deja tal cual y es Node quien falla al
    // arrancar, lo que el runner clasifica como fallo de maquinaria.
    try {
      return join(realpathSync.native(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

export interface ChildCommandInput {
  /** Ruta del script del hijo. */
  readonly script: string;
  /** Rutas permitidas para lectura. Una por flag. */
  readonly allowRead: readonly string[];
  readonly format: CvFileFormat;
  /** Inyectable en tests (p. ej. 32 MB). */
  readonly maxOldSpaceMb?: number;
  readonly maxSemiSpaceMb?: number;
}

export interface ChildCommand {
  readonly command: string;
  readonly args: string[];
  readonly options: SpawnOptions;
}

export function buildChildCommand(input: ChildCommandInput): ChildCommand {
  const args = [
    '--permission',
    ...input.allowRead.map((path) => `--allow-fs-read=${realPathOf(path)}`),
    `--max-old-space-size=${input.maxOldSpaceMb ?? CV_CHILD_MAX_OLD_SPACE_MB}`,
    `--max-semi-space-size=${input.maxSemiSpaceMb ?? CV_CHILD_MAX_SEMI_SPACE_MB}`,
    '--disallow-code-generation-from-strings',
    realPathOf(input.script),
    input.format,
  ];
  return {
    command: process.execPath,
    args,
    options: {
      env: {},
      stdio: ['pipe', 'ignore', 'ignore', 'pipe'],
      detached: false,
      windowsHide: true,
    },
  };
}
