import { defineConfig, mergeConfig } from 'vitest/config';
import { testEnvPreset } from '@linkvault/test-env/preset';

// platform:any: entorno node sin DOM y sin globals; los tests importan describe/it/expect de 'vitest'.
export default mergeConfig(
  testEnvPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/tools/test-env',
    test: {
      name: 'test-env',
      environment: 'node',
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/tools/test-env',
      },
    },
  }),
);
