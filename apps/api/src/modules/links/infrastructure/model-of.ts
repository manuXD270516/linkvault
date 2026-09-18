import type { Connection, Model, Schema } from 'mongoose';

/**
 * Modelo de la conexión de la app, registrándolo la primera vez. Compartido por los adaptadores de `links`: registrar
 * dos veces el mismo nombre en una conexión lanza, y los tests crean varias conexiones sobre la misma base.
 */
export function modelOf<T>(
  connection: Connection,
  name: string,
  schema: Schema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}
