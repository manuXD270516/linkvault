import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashEmailToken } from '../application/email-token';
import type { Clock } from '../domain/clock';
import {
  AUTH_EMAIL_TOKEN_MODEL_NAME,
  AUTH_EMAIL_TOKENS_COLLECTION,
} from './email-token.schemas';
import { MongoEmailTokenRepository } from './mongo-email-token.repository';

const NOW = new Date('2026-09-17T10:00:00.000Z');

class MovableClock implements Clock {
  current = NOW;
  now(): Date {
    return new Date(this.current);
  }
}

let connection: Connection;
let clock: MovableClock;
let repository: MongoEmailTokenRepository;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `email-tokens-${randomUUID()}`,
    })
    .asPromise();
  clock = new MovableClock();
  repository = new MongoEmailTokenRepository(connection, clock);
  await connection.model(AUTH_EMAIL_TOKEN_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

beforeEach(async () => {
  clock.current = NOW;
  await connection.collection(AUTH_EMAIL_TOKENS_COLLECTION).deleteMany({});
});

describe('MongoEmailTokenRepository', () => {
  it('emite, consume, reuse → inválido y caducidad reset 1 h', async () => {
    const plain = 'opaque-reset-token-value';
    const tokenHash = hashEmailToken(plain);
    await repository.issue({
      userId: 'user-ana',
      purpose: 'reset_password',
      tokenHash,
      expiresAt: new Date(NOW.getTime() + 3600_000),
    });

    const stored = await connection
      .collection(AUTH_EMAIL_TOKENS_COLLECTION)
      .findOne({ tokenHash });
    expect(stored).toMatchObject({ userId: 'user-ana', purpose: 'reset_password' });
    expect(JSON.stringify(stored)).not.toContain(plain);
    expect(
      (stored!['expiresAt'] as Date).getTime() -
        (stored!['createdAt'] as Date).getTime(),
    ).toBe(3600_000);

    let marked = false;
    const first = await repository.consume(
      tokenHash,
      'reset_password',
      clock.now(),
      async () => {
        marked = true;
      },
    );
    expect(first).toBe('consumed');
    expect(marked).toBe(true);

    const reuse = await repository.consume(
      tokenHash,
      'reset_password',
      clock.now(),
      async () => {
        throw new Error('should not run');
      },
    );
    expect(reuse).toBe('invalid');

    const expiredHash = hashEmailToken('expired-token');
    await repository.issue({
      userId: 'user-ana',
      purpose: 'reset_password',
      tokenHash: expiredHash,
      expiresAt: new Date(NOW.getTime() + 3600_000),
    });
    clock.current = new Date(NOW.getTime() + 3600_001);
    expect(
      await repository.consume(
        expiredHash,
        'reset_password',
        clock.now(),
        async () => undefined,
      ),
    ).toBe('invalid');
  });

  it('invalida previos al reemitir el mismo purpose', async () => {
    const firstHash = hashEmailToken('first');
    const secondHash = hashEmailToken('second');
    await repository.issue({
      userId: 'user-ana',
      purpose: 'verify_email',
      tokenHash: firstHash,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });
    await repository.issue({
      userId: 'user-ana',
      purpose: 'verify_email',
      tokenHash: secondHash,
      expiresAt: new Date(NOW.getTime() + 86_400_000),
    });

    expect(
      await repository.findValid(firstHash, 'verify_email', clock.now()),
    ).toBeNull();
    expect(
      await repository.findValid(secondHash, 'verify_email', clock.now()),
    ).toMatchObject({ userId: 'user-ana' });
  });
});
