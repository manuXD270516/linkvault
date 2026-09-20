import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REDACTED_DATA_TYPES,
  REDACTED_DATA_TYPE_IDS,
} from './redacted-data-types';

describe('REDACTED_DATA_TYPES', () => {
  it('lista exactamente los seis tipos canónicos sin duplicados', () => {
    const ids = REDACTED_DATA_TYPES.map((entry) => entry.type);

    expect(ids).toEqual([...REDACTED_DATA_TYPE_IDS]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('exige que todo tipo dependiente declare su estado de fábrica', () => {
    const dependent = REDACTED_DATA_TYPES.filter(
      (entry) => entry.switchDependent,
    );

    expect(dependent).toEqual([
      { type: 'name', switchDependent: true, switchFactoryDefault: true },
    ]);
    for (const entry of dependent) {
      expect(entry.switchDependent).toBe(true);
      expect(entry.switchFactoryDefault).toBe(true);
    }
  });

  it('marca el nombre como dependiente y nace activado', () => {
    const name = REDACTED_DATA_TYPES.find((entry) => entry.type === 'name');

    expect(name).toEqual({
      type: 'name',
      switchDependent: true,
      switchFactoryDefault: true,
    });
  });

  it('no importa nada de libs/ai', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'redacted-data-types.ts'),
      'utf8',
    );
    const imports = source
      .split('\n')
      .filter((line) => /^\s*import\b/.test(line));

    expect(imports.join('\n')).not.toMatch(/@linkvault\/ai|libs\/ai/);
  });
});
