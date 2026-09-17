import { defineConfig, mergeConfig } from 'vitest/config';
import { testEnvPreset } from '@linkvault/test-env/preset';

// Vitest para una librería sin decoradores (D5 de bootstrap-monorepo): sin transformador adicional.
// platform:any: entorno node sin DOM y sin globals; los tests importan describe/it/expect de 'vitest'.
export default mergeConfig(
  testEnvPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/libs/shared',
    test: {
      name: 'shared',
      environment: 'node',
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/libs/shared',
      },
    },
  }),
);
