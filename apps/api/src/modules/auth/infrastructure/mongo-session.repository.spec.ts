import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRefreshToken } from '../application/refresh-token';
import type { Clock } from '../domain/clock';
import { RefreshSessionPolicy } from '../domain/refresh-session';
import { MongoSessionRepository } from './mongo-session.repository';
import {
  AUTH_SESSIONS_COLLECTION,
  AUTH_SESSION_MODEL_NAME,
  REFRESH_TOKENS_COLLECTION,
  REFRESH_TOKEN_MODEL_NAME,
} from './session.schemas';

// MongoSessionRepository, parte 1 (tarea 4.6 de auth-users, D4): apertura, revocación y búsqueda por hash contra el
// MongoMemoryReplSet del preset de @linkvault/testing. Se espera `Model.init()` antes de probar índices (D12).

const DAY = 86_400_000;
const NOW = new Date('2026-09-17T10:00:00.000Z');

class MovableClock implements Clock {
  current = NOW;

  now(): Date {
    return new Date(this.current);
  }
}

let connection: Connection;
let clock: MovableClock;
let repository: MongoSessionRepository;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `sessions-${randomUUID()}` })
    .asPromise();
  clock = new MovableClock();
  repository = new MongoSessionRepository(
    connection,
    new RefreshSessionPolicy(clock, { refreshTtlDays: 30, refreshMaxDays: 90 }),
    clock,
  );
  await connection.model(AUTH_SESSION_MODEL_NAME).init();
  await connection.model(REFRESH_TOKEN_MODEL_NAME).init();
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

beforeEach(() => {
  clock.current = NOW;
});

function sessionDocument(sessionId: string) {
  return connection
    .collection<{ _id: string; revokedAt: Date | null }>(
      AUTH_SESSIONS_COLLECTION,
    )
    .findOne({ _id: sessionId });
}

describe('MongoSessionRepository (sessions)', () => {
  it('declares a unique index on tokenHash, TTL indexes on expiresAt and bufferCommands false', async () => {
    const tokenIndexes = await connection
      .collection(REFRESH_TOKENS_COLLECTION)
      .indexes();
    const sessionIndexes = await connection
      .collection(AUTH_SESSIONS_COLLECTION)
      .indexes();

    expect(tokenIndexes).toContainEqual(
      expect.objectContaining({ key: { tokenHash: 1 }, unique: true }),
    );
    expect(tokenIndexes).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    );
    expect(sessionIndexes).toContainEqual(
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }),
    );
    expect(sessionIndexes).toContainEqual(
      expect.objectContaining({ key: { userId: 1 } }),
    );
    expect(
      connection.model(AUTH_SESSION_MODEL_NAME).schema.get('bufferCommands'),
    ).toBe(false);
    expect(
      connection.model(REFRESH_TOKEN_MODEL_NAME).schema.get('bufferCommands'),
    ).toBe(false);
  });

  it('opens a session with its first refresh token', async () => {
    const { tokenHash } = generateRefreshToken();

    const opened = await repository.open('user-open', tokenHash);

    expect(opened).toEqual({
      sessionId: expect.any(String),
      userId: 'user-open',
      expiresAt: new Date(NOW.getTime() + 90 * DAY),
      refreshExpiresAt: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(await sessionDocument(opened.sessionId)).toEqual({
      _id: opened.sessionId,
      userId: 'user-open',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 90 * DAY),
      revokedAt: null,
    });
    expect(await repository.findRefreshToken(tokenHash)).toEqual({
      tokenHash,
      sessionId: opened.sessionId,
      userId: 'user-open',
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
      rotatedAt: null,
      replacedByHash: null,
    });
  });

  it('opens a different session on every login', async () => {
    const first = await repository.open(
      'user-twice',
      generateRefreshToken().tokenHash,
    );
    const second = await repository.open(
      'user-twice',
      generateRefreshToken().tokenHash,
    );

    expect(first.sessionId).not.toBe(second.sessionId);
  });

  it('Refresh token no guardado en claro', async () => {
    const { token, tokenHash } = generateRefreshToken();
    await repository.open('user-hash', tokenHash);

    const tokens = await connection
      .collection(REFRESH_TOKENS_COLLECTION)
      .find({ userId: 'user-hash' })
      .toArray();

    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens)).not.toContain(token);
  });

  it('rejects a duplicated token hash', async () => {
    const { tokenHash } = generateRefreshToken();
    await repository.open('user-dup', tokenHash);

    await expect(repository.open('user-dup', tokenHash)).rejects.toThrow();
  });

  it('returns null for an unknown token hash', async () => {
    expect(
      await repository.findRefreshToken(generateRefreshToken().tokenHash),
    ).toBeNull();
  });

  it('revokes a session once and keeps the first revocation time', async () => {
    const opened = await repository.open(
      'user-revoke',
      generateRefreshToken().tokenHash,
    );
    const first = new Date(NOW.getTime() + 1_000);
    clock.current = first;

    await repository.revokeSession(opened.sessionId);
    clock.current = new Date(NOW.getTime() + 60_000);
    await repository.revokeSession(opened.sessionId);

    expect((await sessionDocument(opened.sessionId))?.revokedAt).toEqual(first);
  });

  it('ignores the revocation of an unknown session', async () => {
    await expect(
      repository.revokeSession(randomUUID()),
    ).resolves.toBeUndefined();
  });

  it('revokes every active session of the user except the kept one', async () => {
    const keep = await repository.open(
      'user-many',
      generateRefreshToken().tokenHash,
    );
    const other = await repository.open(
      'user-many',
      generateRefreshToken().tokenHash,
    );
    const alreadyRevoked = await repository.open(
      'user-many',
      generateRefreshToken().tokenHash,
    );
    const stranger = await repository.open(
      'user-stranger',
      generateRefreshToken().tokenHash,
    );
    await repository.revokeSession(alreadyRevoked.sessionId);
    const revokedAt = new Date(NOW.getTime() + 5_000);
    clock.current = revokedAt;

    const count = await repository.revokeUserSessionsExcept(
      'user-many',
      keep.sessionId,
    );

    expect(count).toBe(1);
    expect((await sessionDocument(keep.sessionId))?.revokedAt).toBeNull();
    expect((await sessionDocument(other.sessionId))?.revokedAt).toEqual(
      revokedAt,
    );
    expect(
      (await sessionDocument(alreadyRevoked.sessionId))?.revokedAt,
    ).toEqual(NOW);
    expect((await sessionDocument(stranger.sessionId))?.revokedAt).toBeNull();
  });
});
