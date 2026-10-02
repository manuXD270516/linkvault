import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Perfil `remote` (design D3, D9). Funciones puras que comparten el runner (`web-e2e:e2e-remote`) y el perfil de
 * Playwright (`src/support/profile.ts`), para que las dos comprobaciones digan lo mismo.
 */

/** Las **únicas** entradas del runner que salen de su entorno: son secretos y en un flag quedarían a la vista (D3). */
export const REMOTE_CREDENTIAL_KEYS = ['E2E_REMOTE_EMAIL', 'E2E_REMOTE_PASSWORD'] as const;

export interface RemoteOrigins {
  /** Origen de la aplicación (`--base-url`). */
  readonly baseUrl: string;
  /** Origen de la API: **siempre** `new URL('/api', <origen>)` (D9). */
  readonly apiOrigin: string;
}

/**
 * Deriva el origen de la API del de la aplicación y, si llega uno declarado (`--api-origin`), exige que sea ese mismo:
 * las credenciales solo viajan al origen derivado. Lanza un error que nombra los dos orígenes (D9).
 */
export function resolveRemoteOrigins(baseUrl: string, declaredApiOrigin: string | undefined): RemoteOrigins {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error(`--base-url "${baseUrl}" is not an absolute URL`);
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error(`--base-url "${baseUrl}" is not an http(s) origin`);
  }
  const derived = new URL('/api', base).href;
  if (declaredApiOrigin !== undefined) {
    let declared: string;
    try {
      declared = new URL(declaredApiOrigin).href;
    } catch {
      throw new Error(`--api-origin "${declaredApiOrigin}" is not an absolute URL`);
    }
    if (withoutTrailingSlash(declared) !== withoutTrailingSlash(derived)) {
      throw new Error(
        `the API origin ${declaredApiOrigin} is not derived from the app origin ${baseUrl} ` +
          `(in the remote profile it is always ${derived}); no credentials were sent to either`,
      );
    }
  }
  return { baseUrl: base.href, apiOrigin: derived };
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * ¿Es un fichero que Nx cargaría en el entorno de la tarea? Nx 23.2.1 (`task-env-paths.js`) carga `.env`,
 * `.env.local`, `.local.env`, `.env.<id>`, `.env.<id>.local`, `.<id>.env` y `.<id>.local.env`, en la raíz y en la del
 * proyecto. Se acepta cualquier nombre con esa forma (un superconjunto), salvo `.env.example`, que no se carga (D3).
 */
export function isLoadedDotEnvName(name: string): boolean {
  if (name === '.env.example') {
    return false;
  }
  return /^\.env(?:\..+)?$/.test(name) || /^\..+\.env$/.test(name);
}

/** Claves de un fichero `.env` (formato de dotenv: `CLAVE=valor`, `export CLAVE=valor`, comentarios con `#`). */
export function dotEnvKeys(text: string): Set<string> {
  const keys = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*[=:]/.exec(line);
    if (match?.[1] !== undefined) {
      keys.add(match[1]);
    }
  }
  return keys;
}

export interface CredentialInDotEnv {
  readonly key: string;
  /** Ruta relativa a la raíz del repositorio. */
  readonly file: string;
}

/**
 * Credenciales remotas escritas en alguno de los `.env*` que Nx cargaría en la tarea (raíz y `apps/web-e2e/`): el runner
 * falla si hay alguna, porque deben ir en el entorno de la sesión, no en un fichero (D3).
 */
export function findCredentialsInDotEnvFiles(root: string, projectDirs: readonly string[]): CredentialInDotEnv[] {
  const found: CredentialInDotEnv[] = [];
  for (const dir of ['', ...projectDirs]) {
    const absolute = join(root, dir);
    if (!existsSync(absolute)) {
      continue;
    }
    for (const name of readdirSync(absolute).sort()) {
      const path = join(absolute, name);
      if (!isLoadedDotEnvName(name) || !statSync(path).isFile()) {
        continue;
      }
      const keys = dotEnvKeys(readFileSync(path, 'utf8'));
      for (const key of REMOTE_CREDENTIAL_KEYS) {
        if (keys.has(key)) {
          found.push({ key, file: dir === '' ? name : `${dir}/${name}` });
        }
      }
    }
  }
  return found;
}
