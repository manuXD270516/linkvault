import { readFileSync } from 'node:fs';

/**
 * Entorno de los procesos que lanza el runner (design D6): **no** hereda el suyo. Cada proceso recibe una lista blanca de
 * variables del sistema, las de `e2e.env` (con las URIs recalculadas desde el bloque efectivo) y las de control.
 */
export const SYSTEM_WHITELIST: readonly string[] = [
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'windir',
  'ComSpec',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TEMP',
  'TMP',
  'TMPDIR',
  'LANG',
  'CI',
];

/**
 * Solo para `docker` en Windows: el CLI busca el plugin `compose` en `%ProgramFiles%\Docker\cli-plugins` y sin esa
 * variable responde «unknown command: docker compose» (medido el 2026-09-27). No llega a las aplicaciones: su entorno
 * efectivo es el que comprueba la tarea 2.4c.
 */
export const DOCKER_WINDOWS_EXTRA: readonly string[] = ['ProgramFiles'];

/** Parser mínimo de `KEY=VALUE` (líneas vacías y `#` de comentario), el formato que también lee `docker compose --env-file`. */
export function parseEnvText(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      throw new Error(`invalid line in env file: "${line}"`);
    }
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      throw new Error(`invalid key in env file: "${key}"`);
    }
    result[key] = line.slice(eq + 1).trim();
  }
  return result;
}

export function readEnvFile(path: string): Record<string, string> {
  return parseEnvText(readFileSync(path, 'utf8'));
}

/** Copia de la lista blanca desde un entorno, sin distinguir mayúsculas en Windows (`Path` y `PATH` son la misma). */
export function pickWhitelisted(
  source: NodeJS.ProcessEnv,
  names: readonly string[],
  platform: NodeJS.Platform,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) {
      continue;
    }
    const match = platform === 'win32'
      ? names.some((name) => name.toLowerCase() === key.toLowerCase())
      : names.includes(key);
    if (match) {
      result[key] = value;
    }
  }
  return result;
}
