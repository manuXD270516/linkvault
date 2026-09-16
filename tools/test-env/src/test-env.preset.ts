import { defineConfig } from 'vitest/config';

/**
 * Variables de entorno que todo proceso de test ve, con o sin `.env` (D7 de bootstrap-monorepo).
 * CLAUDE.md exige la IA en mock determinista durante los tests; CI las define además en su entorno.
 */
export const TEST_ENV = {
  AI_CHAIN: 'mock',
  AI_MOCK_MODE: 'replay',
} as const;

/**
 * Preset parcial de Vitest (platform:any): solo fija `test.env`. Sin dependencias de Node, para que lo
 * puedan extender librerías de cualquier plataforma con `mergeConfig(testEnvPreset, defineConfig({ ... }))`.
 * Entrada `@linkvault/test-env/preset`: la carga Node al leer el vitest.config, así que solo importa paquetes.
 */
export const testEnvPreset = defineConfig({
  test: {
    env: { ...TEST_ENV },
  },
});
