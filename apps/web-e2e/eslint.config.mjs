import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

/**
 * Determinismo de la suite (change `e2e-suite`, design D12): ni esperas fijas ni saltos sin motivo.
 *
 * `no-restricted-syntax` prohíbe en `src/` el `setTimeout` global: el identificador suelto (llamado o pasado como
 * valor), `globalThis`/`window`/`global`/`self.setTimeout` y el de `node:timers` o `node:timers/promises` (importado
 * o con `require`); y `waitForTimeout` sobre un receptor que la regla del plugin no reconoce. `test.setTimeout(…)` y
 * `testInfo.setTimeout(…)`, que son un techo y no una espera, siguen permitidos. `\x2F` en lugar de `/`: el literal regex de los selectores de esquery termina en la primera barra.
 */
const FIXED_WAIT_MESSAGE =
  'Espera fija prohibida en la suite (design D12): espera un evento observable (waitForResponse, waitForURL o una aserción web-first) armado antes de la acción. test.setTimeout(…) sí vale: es un techo.';
const TIMERS_MODULE = '/^(?:node:)?timers(?:\\x2Fpromises)?$/';
const FIXED_WAIT_SELECTORS = [
  {
    selector:
      "Identifier[name='setTimeout']:not(MemberExpression > Identifier.property):not(ImportSpecifier > Identifier):not(Property > Identifier.key)",
    message: FIXED_WAIT_MESSAGE,
  },
  {
    selector:
      "MemberExpression[object.type='Identifier'][object.name=/^(?:globalThis|window|global|self)$/][property.name='setTimeout']",
    message: FIXED_WAIT_MESSAGE,
  },
  {
    selector: `ImportDeclaration[source.value=${TIMERS_MODULE}] > ImportSpecifier[imported.name='setTimeout']`,
    message: FIXED_WAIT_MESSAGE,
  },
  {
    selector: `CallExpression[callee.name='require'][arguments.0.value=${TIMERS_MODULE}]`,
    message: FIXED_WAIT_MESSAGE,
  },
  // `playwright/no-wait-for-timeout` solo reconoce el receptor por su nombre (`page`, `frame`, `…Page`, `…Frame`,
  // eslint-plugin-playwright 1.8.3): `jumper.waitForTimeout(2000)` pasaba sin aviso. Este selector cubre los demás
  // receptores, sin repetir el aviso de la regla del plugin en los que ella ya marca.
  {
    selector:
      "CallExpression[callee.type='MemberExpression'][callee.property.name='waitForTimeout']:not([callee.object.name=/^(?:page|frame)|(?:Page|Frame)$/])",
    message: FIXED_WAIT_MESSAGE,
  },
];

/**
 * ESLint no combina las opciones de una regla entre bloques: el `no-restricted-syntax` de la base (SDKs de IA, ADR-014)
 * se perdería en `src/` si este bloque solo declarase los suyos. Se reutilizan sus selectores tal cual.
 */
const BASE_RESTRICTED_SYNTAX = baseConfig.flatMap((block) => {
  const rule = block.rules?.['no-restricted-syntax'];
  return Array.isArray(rule) ? rule.slice(1) : [];
});

export default [
  // Las reglas de Playwright, solo para los specs de Playwright (`src/`): `scripts/` es el runner y sus Vitest.
  { ...playwright.configs['flat/recommended'], files: ['src/**/*.ts'] },
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    // Override or add rules here
    rules: {},
  },
  {
    files: ['src/**/*.ts'],
    rules: {
      'playwright/no-wait-for-timeout': 'error',
      'playwright/no-wait-for-selector': 'error',
      // También el salto condicional (`allowConditional` es `false` por defecto): el único admitido lleva una excepción
      // de línea con su motivo, y el camino crítico no lleva ninguna.
      'playwright/no-skipped-test': 'error',
      'no-restricted-syntax': ['error', ...BASE_RESTRICTED_SYNTAX, ...FIXED_WAIT_SELECTORS],
    },
  },
];
