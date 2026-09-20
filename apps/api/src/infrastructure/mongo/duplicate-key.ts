import { mongo } from 'mongoose';

// Reconocer **qué índice** rechazó una escritura, para todo `api` (D10 de public-preview-share, ADR-025 §4). Vivía por
// duplicado en `groups` y en `applications`, y este change necesitaba una tercera copia en `links`: tres versiones de
// esta regla acaban divergiendo justo cuando importa. Es el mismo movimiento que ADR-025 §8 hizo con `ipLimitGroup`:
// infraestructura de plataforma que usan varios módulos, sin que ninguno dependa de otro.
//
// Se compara el `keyPattern` **completo** y en orden, no "si incluye un campo": el índice de owner y el de membresía de
// `groups` comparten `groupId`, y el del slug y el de la relación de `group_links` conviven en la misma colección. NO se
// parsea `errmsg`, que no es contrato y además lleva el valor duplicado dentro (un email, un código, un slug).

const DUPLICATE_KEY = 11_000;

/**
 * `true` si `error` es una clave duplicada del índice cuyo `keyPattern` es exactamente `pattern`: los mismos campos, en
 * el mismo orden y con el mismo sentido.
 */
export function duplicateKeyIs(
  error: unknown,
  pattern: Readonly<Record<string, 1 | -1>>,
): boolean {
  if (
    !(error instanceof mongo.MongoServerError) ||
    error.code !== DUPLICATE_KEY
  ) {
    return false;
  }
  const actual: unknown = error['keyPattern'];
  if (typeof actual !== 'object' || actual === null) {
    return false;
  }
  const actualEntries = Object.entries(actual);
  const expectedEntries = Object.entries(pattern);
  return (
    actualEntries.length === expectedEntries.length &&
    expectedEntries.every(([field, direction], index) => {
      const entry = actualEntries[index];
      return entry !== undefined && entry[0] === field && entry[1] === direction;
    })
  );
}
