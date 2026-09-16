import { defineConfig, mergeConfig } from 'vitest/config';
import { testEnvPreset } from '@linkvault/test-env/preset';

// platform:node, type:tooling: sin Mongo; extiende el preset base para ver el entorno de IA en mock como el
// resto de tests del repo.
export default mergeConfig(
  testEnvPreset,
  defineConfig({
    root: import.meta.dirname,
    cacheDir: '../../node_modules/.vite/tools/workspace-rules',
    test: {
      name: 'workspace-rules',
      environment: 'node',
      // workspace-projects.spec.ts calcula el grafo de Nx: sin daemon, que heredaría los pipes de Vitest.
      env: { NX_DAEMON: 'false' },
      globals: false,
      include: ['src/**/*.{spec,test}.ts'],
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/tools/workspace-rules',
      },
    },
  }),
);
