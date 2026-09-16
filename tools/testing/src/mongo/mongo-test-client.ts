import { MongoClient, type ClientSession } from 'mongodb';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    /** URI del MongoMemoryReplSet que arranca mongo-global-setup.ts. */
    mongoTestUri: string;
  }
}

/** URI del replica set efímero que publica el globalSetup del preset de `@linkvault/testing`. */
export function getMongoTestUri(): string {
  return inject('mongoTestUri');
}

/** Abre un cliente conectado al replica set de test. Quien lo abre lo cierra. */
export async function connectMongoTestClient(): Promise<MongoClient> {
  const client = new MongoClient(getMongoTestUri());
  await client.connect();
  return client;
}

/** Ejecuta `work` dentro de una transacción y cierra la sesión pase lo que pase. */
export async function withMongoTransaction<T>(
  client: MongoClient,
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = client.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}
