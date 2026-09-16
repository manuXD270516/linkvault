import type { ConnectOptions } from 'mongoose';

/**
 * Fuente única de las opciones de conexión de Mongoose: las usan `MongooseModule.forRootAsync` y el reintento
 * de la conexión inicial (D8), para que un reintento nunca conecte con opciones distintas. Sin
 * `serverSelectionTimeoutMS`: el valor por defecto es deliberado (el límite de 500 ms es del indicador de salud).
 */
export function buildMongooseConnectOptions(): ConnectOptions {
  return { appName: 'linkvault-worker' };
}
