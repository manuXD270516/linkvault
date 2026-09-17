import nx from '@nx/eslint-plugin';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

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

/**
 * Patrones de `no-restricted-imports` de la capa de dominio (D3 de bootstrap-monorepo, D1 de ai-gateway-core), definidos
 * una sola vez: los usan el bloque genérico `**\/domain/**` y los bloques por módulo de api (D2 de auth-users), porque
 * ESLint no combina las opciones de una regla entre bloques.
 */
const DOMAIN_RESTRICTED_PATTERNS = [
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
  // `domain` no importa de otras capas (D1 de ai-gateway-core). Anclado por segmento de ruta: el bloque
  // aplica a todo `**/domain/**` y `./application.entity` (módulo `applications`) es un import legítimo.
  {
    regex: '(^|/)(application|infrastructure|presentation|tasks)(/|$)',
    message:
      'La capa de dominio no importa de otras capas (application, infrastructure, presentation, tasks): invierte la dependencia con un port.',
  },
  {
    regex: 'ai\\.module$',
    message:
      'La capa de dominio no importa de otras capas (ai.module): invierte la dependencia con un port.',
  },
];

/**
 * Módulos (bounded contexts) de api, leídos del disco para que un módulo nuevo quede cubierto sin tocar esta
 * configuración. Relativo a este archivo y no al cwd: `nx lint` ejecuta ESLint desde cada proyecto.
 */
const API_MODULES_DIR = join(import.meta.dirname, 'apps/api/src/modules');
const API_MODULES = existsSync(API_MODULES_DIR)
  ? readdirSync(API_MODULES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : [];

/** Capas de un módulo de api, para anclar el patrón al segmento siguiente al nombre del módulo. */
const API_MODULE_LAYERS = 'domain|application|infrastructure|presentation';

/**
 * Entrada pública de un módulo de api (D8 de groups): su facade de aplicación, sus errores de dominio y sus dobles
 * de test. Se expresa como alternativas relativas a la raíz del módulo importado, para meterlas en un lookahead
 * negativo. `application/testing` admite el barrel además de los archivos de dentro.
 */
const API_MODULE_PUBLIC_ENTRY =
  'application/[^/]*\\.facade(?:\\.[cm]?[jt]s)?$|domain/errors(?:\\.[cm]?[jt]s)?$|application/testing(?:/|$)';

/**
 * Patrones de `no-restricted-imports` que impiden a un módulo de api importar código de otro (D2 de auth-users,
 * D8 de groups). Los imports entre módulos son siempre relativos (`../../<otro>/…`): los módulos no tienen alias.
 *
 * - `domain/`: prohibición absoluta, sin excepciones (ADR-020 §6). La entrada pública de otro módulo tampoco vale:
 *   el dominio se comunica con eventos o con un port que implementa `infrastructure/`.
 * - `application/` e `infrastructure/`: solo la entrada pública, vía lookahead negativo.
 * - `presentation/`: fuera de la regla, porque el cableado de Nest importa el módulo de otro contexto.
 */
function apiCrossModulePatterns(moduleName, { allowPublicEntry }) {
  return API_MODULES.filter((other) => other !== moduleName).map((other) => ({
    regex: `^(?:\\.\\./)+${other}/${
      allowPublicEntry ? `(?!${API_MODULE_PUBLIC_ENTRY})` : ''
    }(?:${API_MODULE_LAYERS})(?:/|$)`,
    message: allowPublicEntry
      ? `El módulo ${moduleName} solo entra a ${other} por su entrada pública: ${other}/application/*.facade, ${other}/domain/errors o ${other}/application/testing/**.`
      : `El dominio de ${moduleName} no importa el módulo ${other}: comunícalos con eventos de dominio o una fachada desde application.`,
  }));
}

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
        { patterns: DOMAIN_RESTRICTED_PATTERNS },
      ],
    },
  },

  // Dominio de cada módulo de api (D2 de auth-users): además de la lista genérica, no importa otros módulos, y sin
  // ninguna excepción (ni facade, ni domain/errors, ni los dobles de test). Este bloque, posterior, reemplaza las
  // opciones del genérico sobre los mismos archivos, así que lleva la lista completa.
  // `basePath` ancla `files` a la raíz del repo, igual que en los bloques de evals y SDKs.
  ...API_MODULES.map((moduleName) => ({
    basePath: import.meta.dirname,
    files: [`apps/api/src/modules/${moduleName}/domain/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...DOMAIN_RESTRICTED_PATTERNS,
            ...apiCrossModulePatterns(moduleName, { allowPublicEntry: false }),
          ],
        },
      ],
    },
  })),

  // Aplicación e infraestructura de cada módulo de api (D8 de groups): pueden usar el framework y la persistencia,
  // pero de otro módulo solo alcanzan su entrada pública (facade, domain/errors y los dobles de application/testing).
  // Ningún bloque anterior configura `no-restricted-imports` sobre estos archivos, así que la lista no repite la del
  // dominio (ESLint no combina las opciones de una regla entre bloques, ADR-017). `presentation/` queda fuera a
  // propósito: es donde se cablea la inyección de dependencias entre módulos de Nest.
  ...API_MODULES.flatMap((moduleName) => {
    // Con un solo módulo no hay nada que prohibir y `patterns` no admite una lista vacía.
    const patterns = apiCrossModulePatterns(moduleName, {
      allowPublicEntry: true,
    });
    return patterns.length === 0
      ? []
      : [
          {
            basePath: import.meta.dirname,
            files: [
              `apps/api/src/modules/${moduleName}/application/**/*.ts`,
              `apps/api/src/modules/${moduleName}/infrastructure/**/*.ts`,
            ],
            rules: {
              'no-restricted-imports': ['error', { patterns }],
            },
          },
        ];
  }),

  // Eval harness (D1 de ai-eval-harness, ADR-019): `libs/ai/src/evals` corre fuera de Nest con `node --import tsx`, así que
  // no importa framework ni infraestructura, ni el barrel de libs/ai (arrastraría ai.module), ni los dobles de test de
  // application/testing. Usa la regla base `no-restricted-imports`, como el dominio: la de typescript-eslint ya lleva los SDKs
  // de IA y ESLint no combina opciones entre bloques (ADR-017). Ningún archivo casa a la vez con este bloque y con el de
  // dominio (`**/domain/**`) mientras `evals/` no tenga una carpeta `domain`; si la tuviera, este bloque, posterior, lo pisaría.
  {
    basePath: import.meta.dirname,
    files: ['libs/ai/src/evals/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@nestjs/',
              message:
                'El eval harness no importa Nest: compón lo necesario en evals/runner (D3 de ai-eval-harness).',
            },
            {
              regex: '^(?:mongoose|ioredis)(?:/.*)?$',
              message:
                'El eval harness no importa infraestructura de persistencia: usa los dobles propios de evals/runner.',
            },
            // Especificadores que resuelven a un `index` (`.`, `..`, `../..`, `./index`, `**/index`): el barrel de libs/ai
            // exporta ai.module y arrastraría Nest al proceso del harness.
            {
              regex:
                '^(?:\\.{1,2}(?:/\\.\\.)*/?|(?:.*/)?index(?:\\.[cm]?[jt]s)?)$',
              message:
                'El eval harness no importa un index de libs/ai: importa el archivo concreto (p. ej. ../../domain/task).',
            },
            {
              regex: '(?:^|/)ai\\.module(?:\\.[cm]?[jt]s)?$',
              message:
                'El eval harness no importa ai.module: compón RunTask en evals/runner (D3 de ai-eval-harness).',
            },
            {
              regex: '(?:^|/)application/testing(?:/|$)',
              message:
                'El eval harness no importa los dobles de test de application/testing: usa los de evals/runner.',
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
