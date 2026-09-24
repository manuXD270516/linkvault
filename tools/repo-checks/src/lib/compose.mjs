import { readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/** Raíz del workspace, deducida de la ubicación de este fichero (tools/repo-checks/src/lib). */
export const WORKSPACE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../..',
);

export const COMPOSE_PATH = join(WORKSPACE_ROOT, 'docker-compose.prod.yml');

/** Ruta relativa a la raíz, para que los mensajes se puedan pegar en una búsqueda. */
export function relativeToRoot(absolutePath) {
  return absolutePath
    .slice(WORKSPACE_ROOT.length + 1)
    .split(sep)
    .join('/');
}

/**
 * Lee y parsea `docker-compose.prod.yml` **sin interpolar**: lo que se comprueba es el fichero del repositorio, no
 * el resultado de resolverlo contra el entorno de quien lo ejecuta. `docker compose config` haría lo segundo y
 * además exigiría un env file y un daemon.
 */
export function loadCompose() {
  const text = readFileSync(COMPOSE_PATH, 'utf8');
  const document = parse(text);
  if (!document || typeof document !== 'object' || !document.services) {
    throw new Error(`${relativeToRoot(COMPOSE_PATH)} no declara services`);
  }
  return document;
}

/**
 * Bloque `environment` de un servicio, normalizado a mapa `VARIABLE -> valor crudo del YAML`.
 * Acepta las dos formas del formato: mapa (`VAR: valor`) y lista (`- VAR=valor`).
 * Un valor nulo (`VAR:` sin nada detrás) se devuelve como cadena vacía: el compose la declara, aunque vacía.
 */
export function serviceEnvironment(document, service) {
  const block = document.services?.[service]?.environment;
  if (block === undefined) {
    return new Map();
  }
  if (Array.isArray(block)) {
    return new Map(
      block.map((entry) => {
        const text = String(entry);
        const separator = text.indexOf('=');
        return separator === -1
          ? [text, '']
          : [text.slice(0, separator), text.slice(separator + 1)];
      }),
    );
  }
  return new Map(
    Object.entries(block).map(([name, value]) => [
      name,
      value === null || value === undefined ? '' : String(value),
    ]),
  );
}

const INTERPOLATION = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::?[-?+=])?([^}]*)\}/g;

/**
 * Clasifica el valor que el compose da a una variable en un servicio:
 *
 * - `fixed`    → valor literal, sin interpolación (`NODE_ENV: production`).
 * - `default`  → sustitución con valor por defecto (`${VAR:-…}`), con `defaultValue`.
 * - `required` → sustitución obligatoria (`${VAR:?}`), que aborta el `up` nombrando la variable.
 * - `bare`     → `${VAR}` a secas: si la variable no está en el entorno, el contenedor recibe cadena vacía y el
 *                proceso muere **dentro**. La spec de `platform/production-deploy` solo admite las tres de arriba.
 */
export function classifyDeclaration(rawValue) {
  const value = rawValue ?? '';
  const matches = [...value.matchAll(INTERPOLATION)];
  if (matches.length === 0) {
    return { kind: 'fixed', value };
  }
  const kinds = matches.map((match) => {
    const operator = match[0]
      .slice(2 + match[1].length)
      .replace(/\}$/, '')
      .slice(0, 2);
    if (operator.startsWith('?') || operator.startsWith(':?')) {
      return 'required';
    }
    if (operator.startsWith('-') || operator.startsWith(':-')) {
      return 'default';
    }
    return 'bare';
  });
  if (kinds.includes('bare')) {
    return { kind: 'bare', value };
  }
  if (kinds.every((kind) => kind === 'required')) {
    return { kind: 'required', value };
  }
  const first = matches.find((match) =>
    /\$\{[A-Za-z_][A-Za-z0-9_]*:?-/.test(match[0]),
  );
  return { kind: 'default', value, defaultValue: first ? first[2] : '' };
}

/** Una variable está **declarada** si el compose le da valor en ese servicio (fijo, `${VAR:-…}` o `${VAR:?}`). */
export function isDeclared(rawValue) {
  return classifyDeclaration(rawValue).kind !== 'bare';
}
