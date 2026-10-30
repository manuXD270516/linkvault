import swc from 'unplugin-swc';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import { testingPreset } from '@linkvault/testing/preset';

// Vitest para una app NestJS (D5 de bootstrap-monorepo).
// El transformador por defecto de Vite no emite los metadatos de decoradores (design:paramtypes)
// de los que depende la inyección por constructor de Nest; unplugin-swc los emite de forma explícita.
//
// Dos proyectos (D10 y 1.0 de cv-extract-isolation, Vitest 4):
// - `worker`: lo de siempre, sin los specs que abren procesos hijo.
// - `worker-isolation`: los specs de la lectura aislada, **en serie** (un fichero a la vez), con `--expose-gc` y con el
//   hijo real compilado una vez en su `globalSetup`. No usa Mongo, pero `extends: true` hereda el `globalSetup` del
//   preset (Vitest concatena las listas): se acepta y se mide (ver «Estado de las mediciones» del design).
// Los dos llevan `extends: true`: heredan de la raíz `unplugin-swc`, el preset y el `env`. `coverage` es de la raíz.
const ISOLATION_SPECS = [
  'src/modules/cv/infrastructure/isolation/**/*.spec.ts',
  'src/modules/cv/infrastructure/extractors/pathological.spec.ts',
  'src/modules/cv/infrastructure/extractors/extractors.spec.ts',
  'src/modules/cv/application/extract-cv.isolation.spec.ts',
  'src/modules/cv/no-external-calls.spec.ts',
];

export default mergeConfig(
  testingPreset,
  defineConfig({
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
      environment: 'node',
      watch: false,
      passWithNoTests: false,
      coverage: {
        reportsDirectory: '../../coverage/apps/worker',
      },
      projects: [
        {
          extends: true,
          test: {
            name: 'worker',
            include: ['src/**/*.{spec,test}.ts'],
            exclude: [...configDefaults.exclude, ...ISOLATION_SPECS],
          },
        },
        {
          extends: true,
          test: {
            name: 'worker-isolation',
            include: ISOLATION_SPECS,
            fileParallelism: false,
            pool: 'forks',
            execArgv: ['--expose-gc'],
            globalSetup: [
              './src/modules/cv/infrastructure/isolation/isolation-global-setup.ts',
            ],
            setupFiles: [
              './src/modules/cv/infrastructure/isolation/isolation-test-setup.ts',
            ],
          },
        },
      ],
    },
  }),
);
