import playwright from 'eslint-plugin-playwright';
import baseConfig from '../../eslint.config.mjs';

export default [
  // Las reglas de Playwright, solo para los specs de Playwright (`src/`): `scripts/` es el runner y sus Vitest.
  { ...playwright.configs['flat/recommended'], files: ['src/**/*.ts'] },
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    // Override or add rules here
    rules: {},
  },
];
