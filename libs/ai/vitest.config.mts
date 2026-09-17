import swc from 'unplugin-swc';
import { defineConfig, mergeConfig } from 'vitest/config';
import { testingPreset } from '@linkvault/testing/preset';

// Vitest de libs/ai (D14 de ai-gateway-core). Extiende el preset de @linkvault/testing (Mongo en memoria como
// replica set de un nodo) porque el ledger y AiModule necesitan Mongo; revierte a propósito la decisión 4.5 de
// bootstrap-monorepo. Los tests unitarios puros no tocan Mongo.
// El transformador por defecto de Vite no emite design:paramtypes, del que depende la inyección por constructor
// de Nest; unplugin-swc los emite igual que en el worker.
// platform:node: entorno node sin DOM y sin globals; los tests importan describe/it/expect de 'vitest'.
export default mergeConfig(
  testingPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/libs/ai',
    plugins: [
      swc.vite({
        tsconfigFile: false,
        module: { type: 'es6' },
        jsc: {
          target: 'es2022',
          parser: { syntax: 'typescript', decorators: true },
          transform: { legacyDecorator: true, decoratorMetadata: true },
        },
      }),
    ],
    test: {
      name: 'ai',
      environment: 'node',
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/libs/ai',
      },
    },
  }),
);
