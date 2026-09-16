import nx from '@nx/eslint-plugin';

// Configuración base del workspace (flat config).
// Sin reglas con información de tipos (D4 de bootstrap-monorepo): el test de reglas usa
// ESLint.lintText sobre rutas virtuales, que no pertenecen a ningún tsconfig.
// Los bloques de `any` y `console` llegan con la tarea 9.4.

/**
 * Restricciones de dependencias entre proyectos (D2), definidas una sola vez. Tres ejes de tags:
 * scope:* (api, worker, web, shared, ai, tooling), type:* (app, lib, test-util, tooling) y
 * platform:* (node, browser, any). Nx exige que una dependencia cumpla todas las restricciones cuyo
 * sourceTag tenga el proyecto de origen.
 *
 * Esta lista es la del código de producción. Los archivos de test usan `forTestFiles(depConstraints)`,
 * que solo añade `type:test-util` a lo permitido; el resto (incluida la plataforma) se mantiene.
 */
const depConstraints = [
  // Eje type: el producto solo depende de librerías (nunca de utilidades de test, tooling ni apps).
  // Se expresa con onlyDependOnLibsWithTags y no con notDependOnLibsWithTags porque Nx evalúa esta última
  // de forma transitiva sobre el grafo, que no distingue imports de test: api -> shared -> test-env (por
  // el vitest.config de shared) marcaría como violación cualquier import de @linkvault/shared.
  { sourceTag: 'type:app', onlyDependOnLibsWithTags: ['type:lib'] },
  { sourceTag: 'type:lib', onlyDependOnLibsWithTags: ['type:lib'] },
  // Utilidades de test: pueden usar librerías de producto (p. ej. schemas de shared) y otras utilidades
  // de test; nunca apps ni tooling.
  {
    sourceTag: 'type:test-util',
    onlyDependOnLibsWithTags: ['type:lib', 'type:test-util'],
  },
  // Tooling (reglas, e2e): puede usar librerías y utilidades de test; nunca apps. Nadie de producto
  // depende de él (restricciones de type:app y type:lib).
  {
    sourceTag: 'type:tooling',
    onlyDependOnLibsWithTags: ['type:lib', 'type:test-util', 'type:tooling'],
  },

  // Eje scope.
  { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: ['scope:shared'] },
  { sourceTag: 'scope:ai', onlyDependOnLibsWithTags: ['scope:shared'] },
  {
    sourceTag: 'scope:tooling',
    onlyDependOnLibsWithTags: ['scope:shared', 'scope:tooling'],
  },

  // Eje platform: el navegador no depende de Node; lo agnóstico no depende de ninguna plataforma concreta.
  {
    sourceTag: 'platform:browser',
    onlyDependOnLibsWithTags: ['platform:browser', 'platform:any'],
  },
  { sourceTag: 'platform:any', onlyDependOnLibsWithTags: ['platform:any'] },
];

/**
 * Variante para archivos de test: añade `type:test-util` a lo permitido en las restricciones de type y
 * scope. Las de platform no cambian: `web` no puede importar `tools/testing`.
 * Se deriva de `depConstraints` porque ESLint no combina las opciones de una regla entre bloques: el
 * bloque de tests debe llevar la lista completa, no solo la excepción.
 */
function forTestFiles(constraints) {
  return constraints.map((constraint) =>
    constraint.sourceTag.startsWith('platform:') ||
    constraint.onlyDependOnLibsWithTags.includes('type:test-util')
      ? constraint
      : {
          ...constraint,
          onlyDependOnLibsWithTags: [
            ...constraint.onlyDependOnLibsWithTags,
            'type:test-util',
          ],
        },
  );
}

const moduleBoundariesOptions = (constraints) => [
  'error',
  {
    enforceBuildableLibDependency: true,
    allow: [
      '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
      // Versión de la app desde el package.json raíz (D9), que no pertenece a ningún proyecto.
      '^(\\.\\./)+package\\.json$',
    ],
    depConstraints: constraints,
  },
];

const sourceFiles = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.mts',
  '**/*.cts',
  '**/*.js',
  '**/*.jsx',
  '**/*.mjs',
  '**/*.cjs',
];
const testFiles = ['**/*.spec.ts', '**/*.test.ts', '**/vitest.config.*'];

/**
 * Lista cerrada de SDKs de proveedores de IA (spec workspace, ADR-014), definida una sola vez para los imports
 * estáticos (`@typescript-eslint/no-restricted-imports`) y para `import()` y `require` (`no-restricted-syntax`).
 * `\x2F` en lugar de `/`: el literal regex de los selectores de esquery termina en la primera barra.
 */
const AI_SDK_MODULE_REGEX =
  '^(?:@anthropic-ai\\x2F.+|@openrouter\\x2F.+|(?:openai|ollama|openrouter)(?:\\x2F.*)?)$';
const AI_SDK_MESSAGE =
  'Los SDKs de proveedores de IA solo se importan en libs/ai/src/infrastructure/providers (ADR-014); el resto usa runTask de @linkvault/ai.';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/coverage',
      '**/tmp',
      '**/.nx',
      '**/node_modules',
      '**/vitest.config.*.timestamp*',
    ],
  },

  // Límites entre proyectos (D2): código de producción.
  {
    files: sourceFiles,
    rules: {
      '@nx/enforce-module-boundaries': moduleBoundariesOptions(depConstraints),
    },
  },
  // Límites entre proyectos (D2): archivos de test, con la misma lista más type:test-util permitido.
  {
    files: testFiles,
    rules: {
      '@nx/enforce-module-boundaries': moduleBoundariesOptions(
        forTestFiles(depConstraints),
      ),
    },
  },

  // Capa de dominio (D3): lista cerrada de paquetes de infraestructura, incluidas sus subrutas.
  // Usa la regla base `no-restricted-imports`; los SDKs de IA van en `@typescript-eslint/no-restricted-imports`
  // para que ambas listas apliquen a la vez sobre libs/ai/src/domain (ESLint no combina opciones entre bloques).
  {
    files: ['**/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?:@nestjs|@fastify|@aws-sdk)/',
              message:
                'La capa de dominio no importa infraestructura: mueve este uso a infrastructure/ y expón un port.',
            },
            {
              regex:
                '^(?:mongoose|mongodb|bullmq|ioredis|fastify|minio|pino|nestjs-pino)(?:/.*)?$',
              message:
                'La capa de dominio no importa infraestructura: mueve este uso a infrastructure/ y expón un port.',
            },
          ],
        },
      ],
    },
  },

  // Sin `any` explícito ni `console` (CLAUDE.md): en proyectos de producto y también en tools/*, que no tienen
  // un uso legítimo de ninguno de los dos. Los logs pasan por pino; los scripts de arranque, por process.stderr.
  {
    files: sourceFiles,
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },

  // SDKs de proveedores de IA (D3, ADR-014): solo libs/ai/src/infrastructure/providers puede importarlos.
  // Regla distinta de la del dominio (`@typescript-eslint/no-restricted-imports`) para que en libs/ai/src/domain
  // se reporten ambas violaciones. `basePath` ancla `ignores` a la raíz del repo: `nx lint` ejecuta ESLint
  // desde cada proyecto con su propio eslint.config.mjs, y sin él la ruta relativa no casaría.
  {
    basePath: import.meta.dirname,
    files: sourceFiles,
    ignores: ['libs/ai/src/infrastructure/providers/**'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: AI_SDK_MODULE_REGEX,
              message: AI_SDK_MESSAGE,
            },
          ],
        },
      ],
      // `import('sdk')` y `require('sdk')` no pasan por no-restricted-imports. Ningún otro bloque configura
      // no-restricted-syntax sobre estos archivos; si se añade uno, ESLint no combinaría las opciones (D3).
      'no-restricted-syntax': [
        'error',
        {
          selector: `ImportExpression[source.value=/${AI_SDK_MODULE_REGEX}/]`,
          message: AI_SDK_MESSAGE,
        },
        {
          selector: `CallExpression[callee.name='require'][arguments.0.value=/${AI_SDK_MODULE_REGEX}/]`,
          message: AI_SDK_MESSAGE,
        },
      ],
    },
  },
];
