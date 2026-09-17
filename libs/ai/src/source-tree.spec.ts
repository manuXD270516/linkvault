import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Escenario "El árbol de carpetas refleja el ADR-014" (spec platform/workspace).
// Las rutas son relativas a la raíz de fuentes de libs/ai (D1 de bootstrap-monorepo).
const adr014Folders = [
  'domain/ports',
  'application',
  'infrastructure/providers',
  'infrastructure/prompts',
  'infrastructure/fixtures',
  'evals',
] as const;

describe('libs/ai source tree', () => {
  it.each(adr014Folders)('contains the ADR-014 folder %s', (folder) => {
    const path = join(import.meta.dirname, folder);
    expect(statSync(path, { throwIfNoEntry: false })?.isDirectory()).toBe(true);
  });
});
