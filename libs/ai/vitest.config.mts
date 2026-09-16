import { defineConfig } from 'vitest/config';

// Vitest para una librería sin decoradores (D5 de bootstrap-monorepo): sin transformador adicional.
// platform:node: entorno node sin DOM y sin globals; los tests importan describe/it/expect de 'vitest'.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/libs/ai',
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
});
