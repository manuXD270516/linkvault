import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RotationResult } from '../application/ports/session-repository.port';
import { generateRefreshToken } from '../application/refresh-token';
import type { Clock } from '../domain/clock';
import { RefreshSessionPolicy } from '../domain/refresh-session';
import { MongoSessionRepository } from './mongo-session.repository';
import {
  AUTH_SESSION_MODEL_NAME,
  AUTH_SESSIONS_COLLECTION,
  REFRESH_TOKEN_MODEL_NAME,
  REFRESH_TOKENS_COLLECTION,
} from './session.schemas';

// MongoSessionRepository, parte 2 (tarea 4.7 de auth-users, D4): rotación dentro de `withTransaction` sobre el
// MongoMemoryReplSet del preset. La transacción devuelve el resultado y confirma; el reuso revoca sin lanzar.

const SECOND = 1_000;
const DAY = 86_400_000;
const NOW = new Date('2026-09-17T10:00:00.000Z');

class MovableClock implements Clock {
  current = NOW;

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

let connection: Connection;
let clock: MovableClock;
let repository: MongoSessionRepository;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `rotation-${randomUUID()}` })
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

async function openSession(userId = `user-${randomUUID()}`) {
  const first = generateRefreshToken();
  const opened = await repository.open(userId, first.tokenHash);
  return { ...opened, tokenHash: first.tokenHash };
}

function rotate(tokenHash: string) {
  const successor = generateRefreshToken();
  return repository
    .rotate({ tokenHash, successorHash: successor.tokenHash })
    .then((result) => ({ result, successorHash: successor.tokenHash }));
}

async function revokedAt(sessionId: string): Promise<Date | null> {
  const document = await connection
    .collection<{ _id: string; revokedAt: Date | null }>(
      AUTH_SESSIONS_COLLECTION,
    )
    .findOne({ _id: sessionId });
  return document?.revokedAt ?? null;
}

function outcomes(results: readonly { result: RotationResult }[]): string[] {
  return results.map(({ result }) => result.outcome).sort();
}

describe('MongoSessionRepository (rotation)', () => {
  it('Rotación correcta', async () => {
    const session = await openSession();

    const { result, successorHash } = await rotate(session.tokenHash);

    expect(result).toEqual({
      outcome: 'rotated',
      sessionId: session.sessionId,
      userId: session.userId,
      refreshExpiresAt: new Date(NOW.getTime() + 30 * DAY),
    });
    expect(await repository.findRefreshToken(session.tokenHash)).toMatchObject({
      rotatedAt: NOW,
      replacedByHash: successorHash,
    });
    expect(await repository.findRefreshToken(successorHash)).toEqual({
      tokenHash: successorHash,
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
      rotatedAt: null,
      replacedByHash: null,
    });
  });

  it('Caducidad deslizante con máximo absoluto', async () => {
    const session = await openSession();
    clock.advance(25 * DAY);
    const second = await rotate(session.tokenHash);
    clock.advance(25 * DAY);
    const third = await rotate(second.successorHash);
    clock.advance(29 * DAY);

    const { result } = await rotate(third.successorHash);

    expect(result).toMatchObject({
      outcome: 'rotated',
      refreshExpiresAt: new Date(NOW.getTime() + 90 * DAY),
    });
  });

  it('rejects an unknown token and an expired one', async () => {
    const session = await openSession();

    expect((await rotate(generateRefreshToken().tokenHash)).result).toEqual({
      outcome: 'invalid',
      reason: 'unknown_token',
    });
    clock.advance(30 * DAY);
    expect((await rotate(session.tokenHash)).result).toEqual({
      outcome: 'invalid',
      reason: 'token_expired',
    });
  });

  it('two concurrent rotations of the same token: one wins and the other gets conflict', async () => {
    const session = await openSession();

    const results = await Promise.all([
      rotate(session.tokenHash),
      rotate(session.tokenHash),
    ]);

    expect(outcomes(results)).toEqual(['conflict', 'rotated']);
    const winner = results.find(({ result }) => result.outcome === 'rotated');
    const loser = results.find(({ result }) => result.outcome === 'conflict');
    expect(loser?.result).toEqual({
      outcome: 'conflict',
      sessionId: session.sessionId,
      userId: session.userId,
    });
    expect(
      await repository.findRefreshToken(winner?.successorHash ?? ''),
    ).not.toBeNull();
    expect(
      await repository.findRefreshToken(loser?.successorHash ?? ''),
    ).toBeNull();
    expect(await repository.findRefreshToken(session.tokenHash)).toMatchObject({
      replacedByHash: winner?.successorHash,
    });
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('Tres refresh concurrentes con el mismo token', async () => {
    const session = await openSession();

    const results = await Promise.all([
      rotate(session.tokenHash),
      rotate(session.tokenHash),
      rotate(session.tokenHash),
    ]);

    expect(outcomes(results)).toEqual(['conflict', 'conflict', 'rotated']);
    expect(await revokedAt(session.sessionId)).toBeNull();
    expect(
      await connection
        .collection(REFRESH_TOKENS_COLLECTION)
        .countDocuments({ sessionId: session.sessionId }),
    ).toBe(2);
  });

  it('Refresh concurrente', async () => {
    const session = await openSession();
    const first = await rotate(session.tokenHash);
    clock.advance(2 * SECOND);

    expect((await rotate(session.tokenHash)).result.outcome).toBe('conflict');
    expect((await rotate(first.successorHash)).result.outcome).toBe('rotated');
  });

  it('returns conflict inside the window even after the successor was used', async () => {
    const session = await openSession();
    const first = await rotate(session.tokenHash);
    clock.advance(SECOND);
    await rotate(first.successorHash);
    clock.advance(SECOND);

    expect((await rotate(session.tokenHash)).result.outcome).toBe('conflict');
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it.each([10, 11])(
    'Reuso revoca la sesión (%i s after the rotation)',
    async (seconds) => {
      const session = await openSession();
      const first = await rotate(session.tokenHash);
      clock.advance(seconds * SECOND);
      const reusedAt = clock.now();

      const { result } = await rotate(session.tokenHash);

      expect(result).toEqual({
        outcome: 'reused',
        sessionId: session.sessionId,
        userId: session.userId,
      });
      expect(await revokedAt(session.sessionId)).toEqual(reusedAt);
      expect((await rotate(first.successorHash)).result).toEqual({
        outcome: 'invalid',
        reason: 'session_revoked',
      });
    },
  );

  it('Revocación durante un refresh', async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const session = await openSession();

      const [rotation] = await Promise.all([
        rotate(session.tokenHash),
        repository.revokeSession(session.sessionId),
      ]);

      // Gane quien gane, ningún refresh token emitido por ese refresh sirve después.
      expect((await rotate(rotation.successorHash)).result.outcome).toBe(
        'invalid',
      );
      expect(await revokedAt(session.sessionId)).not.toBeNull();
    }
  });
});
