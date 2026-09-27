import { defineConfig } from 'vitest/config';

// Vitest de las funciones puras del runner de la suite (`scripts/lib`, design D3 y D4). Los specs de Playwright viven
// en `src/` y no los recoge este fichero.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/web-e2e',
  test: {
    name: 'web-e2e',
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.spec.ts'],
    watch: false,
    passWithNoTests: false,
  },
});
