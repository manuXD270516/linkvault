import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// La convención de ADR-028 §9, comprobada y no confiada a la memoria: los contratos de plataforma —el outbox y la
// sesión de transacción— los consumen `application/` e `infrastructure/` de los módulos, y **nunca `domain/`**, que
// no conoce ni framework ni transporte.
//
// El lint de capas ya prohíbe que un `domain/` importe `mongoose`, `bullmq` o un paquete de infraestructura, pero
// estos dos archivos son TypeScript nuestro y no un paquete: su ruta no casa con ninguna lista cerrada. Este test es
// lo que cierra ese hueco; sin él, el día que alguien pase una `TransactionSession` a una entidad, nada fallaría.

const API_SRC = join(import.meta.dirname, '../..');

/** Todos los `.ts` que cuelgan de una carpeta `domain/` de `apps/api/src`. */
function domainFiles(dir: string, insideDomain = false): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...domainFiles(path, insideDomain || entry.name === 'domain'));
    } else if (insideDomain && entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

describe('the platform outbox contracts', () => {
  const files = domainFiles(API_SRC);

  it('finds the domain folders it is meant to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(['outbox.port', 'transaction-session'])(
    'is never imported from a domain folder (%s)',
    (contract) => {
      const offenders = files.filter((file) =>
        new RegExp(`from '[^']*infrastructure/outbox/${contract}'`).test(
          readFileSync(file, 'utf8'),
        ),
      );

      expect(offenders).toEqual([]);
    },
  );

  it('keeps a single OUTBOX token, shared by every module that enqueues work', () => {
    const declarations = domainOrModuleFiles().filter((file) =>
      // `OUTBOX` y cualquier `X_OUTBOX` que alguien declarara; `OUTBOX_PUBLISHER` y `OUTBOX_CLOCK` son otra cosa.
      /export const (?:[A-Z_]+_)?OUTBOX = Symbol\(/.test(
        readFileSync(file, 'utf8'),
      ),
    );

    expect(
      declarations.map((file) =>
        relative(API_SRC, file).split(sep).join('/'),
      ),
    ).toEqual(['infrastructure/outbox/outbox.port.ts']);
  });
});

/** Todos los `.ts` de `apps/api/src`, sin los de test. */
function domainOrModuleFiles(dir: string = API_SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...domainOrModuleFiles(path));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      found.push(path);
    }
  }
  return found;
}
