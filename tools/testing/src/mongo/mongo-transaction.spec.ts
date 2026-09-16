import type { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  connectMongoTestClient,
  withMongoTransaction,
} from './mongo-test-client';

describe('MongoMemoryReplSet from the testing preset', () => {
  let client: MongoClient;

  beforeAll(async () => {
    client = await connectMongoTestClient();
  });

  afterAll(async () => {
    await client.close();
  });

  it('commits a multi-document transaction across two collections', async () => {
    const db = client.db('testing-probe');
    const left = db.collection<{ marker: string }>('left');
    const right = db.collection<{ marker: string }>('right');
    await db.createCollection('left');
    await db.createCollection('right');

    await withMongoTransaction(client, async (session) => {
      await left.insertOne({ marker: 'tx' }, { session });
      await right.insertOne({ marker: 'tx' }, { session });
    });

    expect(await left.countDocuments({ marker: 'tx' })).toBe(1);
    expect(await right.countDocuments({ marker: 'tx' })).toBe(1);
  });
});
