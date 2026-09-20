import type { ConnectOptions } from 'mongoose';

/**
 * Fuente única de las opciones de conexión de Mongoose: las usan `MongooseModule.forRootAsync` y el reintento
 * de la conexión inicial (D8), para que un reintento nunca conecte con opciones distintas. Sin
 * `serverSelectionTimeoutMS`: el valor por defecto es deliberado (el límite de 500 ms es del indicador de salud).
 *
 * `monitorCommands` se enciende **solo con `NODE_ENV=test`**: es lo que deja a un test de integración contar las
 * operaciones que una petición manda de verdad al driver —las dos lecturas y ninguna escritura de la página pública
 * (D7 de public-preview-share)— sin pedirle nada al código de producción. Emitir esos eventos tiene coste, así que
 * fuera de los tests no se activa.
 */
export function buildMongooseConnectOptions(
  nodeEnv?: string,
): ConnectOptions {
  return {
    appName: 'linkvault-api',
    ...(nodeEnv === 'test' ? { monitorCommands: true } : {}),
  };
}
