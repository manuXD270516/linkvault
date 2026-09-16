import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// Vitest para una app NestJS (D5 de bootstrap-monorepo).
// El transformador por defecto de Vite no emite los metadatos de decoradores (design:paramtypes)
// de los que depende la inyección por constructor de Nest; unplugin-swc los emite de forma explícita.
export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/worker',
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
    name: 'worker',
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    watch: false,
    passWithNoTests: false,
    coverage: {
      reportsDirectory: '../../coverage/apps/worker',
    },
  },
});
