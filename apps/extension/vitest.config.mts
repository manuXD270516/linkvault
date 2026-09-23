import { defineConfig, mergeConfig } from 'vitest/config';
import { testEnvPreset } from '@linkvault/test-env/preset';

export default mergeConfig(
  testEnvPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/apps/extension',
    define: {
      __EXTENSION_API_BASE_URL__: JSON.stringify('http://localhost:3000'),
    },
    test: {
      name: 'extension',
      environment: 'node',
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/apps/extension',
      },
    },
  }),
);
