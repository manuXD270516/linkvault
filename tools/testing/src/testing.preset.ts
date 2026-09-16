import { fileURLToPath } from 'node:url';
import { testEnvPreset } from '@linkvault/test-env/preset';
import { defineConfig, mergeConfig } from 'vitest/config';

/**
 * Versión exacta del binario de MongoDB para los tests (D7 de bootstrap-monorepo): la misma que la imagen
 * `mongo` de docker-compose.yml. CI la usa como clave de caché de los binarios de mongodb-memory-server.
 */
export const MONGOMS_VERSION = '7.0.43';

/**
 * Preset de Vitest para proyectos platform:node que necesitan MongoDB. Extiende el de `@linkvault/test-env`
 * (variables de IA) y añade un globalSetup que arranca un MongoMemoryReplSet de un nodo por proyecto.
 *
 * Entrada `@linkvault/testing/preset`: la carga Node al leer el vitest.config del consumidor, así que solo
 * puede importar paquetes (no módulos relativos sin extensión).
 */
export const testingPreset = mergeConfig(
  testEnvPreset,
  defineConfig({
    test: {
      env: { MONGOMS_VERSION },
      globalSetup: [
        fileURLToPath(
          new URL('./mongo/mongo-global-setup.ts', import.meta.url),
        ),
      ],
    },
  }),
);
