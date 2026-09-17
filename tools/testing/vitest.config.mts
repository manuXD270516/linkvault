import { defineConfig, mergeConfig } from 'vitest/config';
import { testingPreset } from '@linkvault/testing/preset';

// platform:node: entorno node sin DOM y sin globals; los tests importan describe/it/expect de 'vitest'.
export default mergeConfig(
  testingPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/tools/testing',
    test: {
      name: 'testing',
      environment: 'node',
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/tools/testing',
      },
    },
  }),
);
