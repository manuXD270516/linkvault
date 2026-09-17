import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import type { TestProject } from 'vitest/node';
import { MONGOMS_VERSION } from '../testing.preset';
import type {} from './mongo-test-client';

/**
 * Arranca un replica set de un nodo (transacciones multi-documento disponibles) antes de los tests del
 * proyecto y lo detiene al terminar. La URI llega a los tests con `inject('mongoTestUri')`.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    binary: { version: MONGOMS_VERSION },
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  await replSet.waitUntilRunning();
  project.provide('mongoTestUri', replSet.getUri());

  return async () => {
    await replSet.stop();
  };
}
