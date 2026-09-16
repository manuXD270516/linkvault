import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_ROOT } from './workspace-root';

// Base de las pruebas de reglas (D4 de bootstrap-monorepo): ESLint con la configuración real del repo sobre
// rutas virtuales. Las filas por regla llegan con la tarea 9.5.
describe('workspace ESLint configuration', () => {
  it('lints virtual source text with the real repository config', async () => {
    const eslint = new ESLint({ cwd: WORKSPACE_ROOT });
    const filePath = 'libs/shared/src/probe.ts';

    // calculateConfigForFile está tipado como Promise<any> en eslint; se estrecha a la forma de flat config.
    const config: Linter.Config | undefined =
      await eslint.calculateConfigForFile(filePath);
    const results = await eslint.lintText('export const x = 1;\n', {
      filePath,
    });

    expect(Object.keys(config?.rules ?? {}).length).toBeGreaterThan(0);
    expect(results).toHaveLength(1);
    expect(results[0]?.messages).toEqual([]);
    expect(results[0]?.errorCount).toBe(0);
  }, 30_000);
});
