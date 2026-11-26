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

function rotate(
  tokenHash: string,
  expectedClient: 'web' | 'extension' = 'web',
) {
  const successor = generateRefreshToken();
  return repository
    .rotate({
      tokenHash,
      successorHash: successor.tokenHash,
      expectedClient,
    })
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
      reissued: false,
      reissueCount: 0,
    });
    expect(await repository.findRefreshToken(session.tokenHash)).toMatchObject({
      rotatedAt: NOW,
      replacedByHash: successorHash,
      reissueCount: 0,
    });
    expect(await repository.findRefreshToken(successorHash)).toEqual({
      tokenHash: successorHash,
      sessionId: session.sessionId,
      userId: session.userId,
      createdAt: NOW,
      expiresAt: new Date(NOW.getTime() + 30 * DAY),
      rotatedAt: null,
      replacedByHash: null,
      parentHash: session.tokenHash,
      advancedAt: null,
      reissueCount: null,
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

  it('two concurrent rotations of the same token: one rotates and the other is reissued a sibling', async () => {
    const session = await openSession();

    const results = await Promise.all([
      rotate(session.tokenHash),
      rotate(session.tokenHash),
    ]);

    expect(outcomes(results)).toEqual(['rotated', 'rotated']);
    expect(
      results.filter(
        ({ result }) => result.outcome === 'rotated' && result.reissued,
      ),
    ).toHaveLength(1);
    for (const { successorHash } of results) {
      expect(await repository.findRefreshToken(successorHash)).toMatchObject({
        parentHash: session.tokenHash,
      });
    }
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('Tres refresh concurrentes con el mismo token', async () => {
    const session = await openSession();

    const results = await Promise.all([
      rotate(session.tokenHash),
      rotate(session.tokenHash),
      rotate(session.tokenHash),
    ]);

    expect(outcomes(results)).toEqual(['rotated', 'rotated', 'rotated']);
    expect(
      new Set(results.map(({ successorHash }) => successorHash)).size,
    ).toBe(3);
    expect(await revokedAt(session.sessionId)).toBeNull();
    expect(
      await connection
        .collection(REFRESH_TOKENS_COLLECTION)
        .countDocuments({ sessionId: session.sessionId }),
    ).toBe(4);
    // Al usar uno, los otros dos quedan superados.
    clock.advance(SECOND);
    const [used, ...others] = results;
    expect((await rotate(used.successorHash)).result.outcome).toBe('rotated');
    clock.advance(SECOND);
    for (const { successorHash } of others) {
      expect((await rotate(successorHash)).result.outcome).toBe('conflict');
    }
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('Refresh concurrente', async () => {
    const session = await openSession();
    const first = await rotate(session.tokenHash);
    const second = await rotate(first.successorHash);
    clock.advance(2 * SECOND);

    // R2 ya rotó: R1 deja de reemitirse aunque siga dentro de la ventana.
    expect((await rotate(session.tokenHash)).result.outcome).toBe('conflict');
    expect((await rotate(second.successorHash)).result.outcome).toBe('rotated');
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('El hermano usado deja superados a los demás', async () => {
    const session = await openSession();
    const first = await rotate(session.tokenHash); // R1 -> R2
    clock.advance(SECOND);
    const reissue = await rotate(session.tokenHash); // R3, hermano de R2
    expect(reissue.result).toMatchObject({
      outcome: 'rotated',
      reissued: true,
    });
    clock.advance(SECOND);
    const usedAt = clock.now();

    const used = await rotate(reissue.successorHash); // R3 se usa

    expect(used.result).toMatchObject({ outcome: 'rotated', reissued: false });
    expect(await repository.findRefreshToken(session.tokenHash)).toMatchObject({
      advancedAt: usedAt,
    });
    expect(
      await repository.findRefreshToken(first.successorHash),
    ).toMatchObject({ rotatedAt: usedAt, advancedAt: usedAt });
    clock.advance(SECOND);
    expect((await rotate(first.successorHash)).result.outcome).toBe('conflict');
    expect(await revokedAt(session.sessionId)).toBeNull();
    clock.advance(10 * SECOND);
    expect((await rotate(first.successorHash)).result.outcome).toBe('reused');
    expect(await revokedAt(session.sessionId)).not.toBeNull();
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

  it('Respuesta de rotación perdida', async () => {
    const session = await openSession();
    const first = await rotate(session.tokenHash);
    // La respuesta se perdió: el sucesor se descarta y el cliente vuelve con el token viejo 2 s después.
    clock.advance(2 * SECOND);

    const { result, successorHash } = await rotate(session.tokenHash);

    expect(result).toEqual({
      outcome: 'rotated',
      sessionId: session.sessionId,
      userId: session.userId,
      refreshExpiresAt: new Date(NOW.getTime() + 2 * SECOND + 30 * DAY),
      reissued: true,
      reissueCount: 1,
    });
    expect(successorHash).not.toBe(first.successorHash);
    expect(await repository.findRefreshToken(successorHash)).toMatchObject({
      sessionId: session.sessionId,
      parentHash: session.tokenHash,
      rotatedAt: null,
      advancedAt: null,
    });
    // La ventana sigue anclada a la primera rotación y el primer sucesor queda como estaba.
    expect(await repository.findRefreshToken(session.tokenHash)).toMatchObject({
      rotatedAt: NOW,
      replacedByHash: first.successorHash,
      reissueCount: 1,
    });
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('Respuesta perdida fuera de la ventana', async () => {
    const session = await openSession();
    await rotate(session.tokenHash);
    clock.advance(11 * SECOND);

    const { result } = await rotate(session.tokenHash);

    expect(result).toEqual({
      outcome: 'reused',
      sessionId: session.sessionId,
      userId: session.userId,
    });
    expect(await revokedAt(session.sessionId)).not.toBeNull();
    expect(
      await connection
        .collection(REFRESH_TOKENS_COLLECTION)
        .countDocuments({ sessionId: session.sessionId }),
    ).toBe(2);
  });

  it('Tope de reemisiones', async () => {
    const session = await openSession();
    await rotate(session.tokenHash);

    for (const expected of [1, 2, 3]) {
      clock.advance(SECOND);
      const { result } = await rotate(session.tokenHash);
      expect(result).toMatchObject({
        outcome: 'rotated',
        reissued: true,
        reissueCount: expected,
      });
    }
    clock.advance(SECOND);
    const fourth = await rotate(session.tokenHash);

    expect(fourth.result).toEqual({
      outcome: 'conflict',
      sessionId: session.sessionId,
      userId: session.userId,
    });
    expect(await repository.findRefreshToken(fourth.successorHash)).toBeNull();
    expect(await revokedAt(session.sessionId)).toBeNull();
    expect(
      await connection
        .collection(REFRESH_TOKENS_COLLECTION)
        .countDocuments({ sessionId: session.sessionId }),
    ).toBe(5);
  });

  it('Token rotado antes de la reemisión', async () => {
    const session = await openSession();
    await rotate(session.tokenHash);
    // Una versión sin reemisión no escribía `reissueCount`.
    await connection
      .collection(REFRESH_TOKENS_COLLECTION)
      .updateOne(
        { tokenHash: session.tokenHash },
        { $unset: { reissueCount: '' } },
      );
    clock.advance(2 * SECOND);

    const { result, successorHash } = await rotate(session.tokenHash);

    expect(result).toEqual({
      outcome: 'conflict',
      sessionId: session.sessionId,
      userId: session.userId,
    });
    expect(await repository.findRefreshToken(successorHash)).toBeNull();
    expect(await revokedAt(session.sessionId)).toBeNull();
  });

  it('rejects rotation when expectedClient does not match the session', async () => {
    const first = generateRefreshToken();
    const opened = await repository.open(
      `user-${randomUUID()}`,
      first.tokenHash,
      'extension',
    );

    const { result } = await rotate(first.tokenHash, 'web');

    expect(result).toEqual({ outcome: 'invalid', reason: 'unknown_token' });
    expect(await revokedAt(opened.sessionId)).toBeNull();
    expect((await rotate(first.tokenHash, 'extension')).result.outcome).toBe(
      'rotated',
    );
  });

  it('treats legacy sessions without client as web', async () => {
    const first = generateRefreshToken();
    const opened = await repository.open(
      `user-${randomUUID()}`,
      first.tokenHash,
      'web',
    );
    await connection
      .collection<{ _id: string; client?: string }>(AUTH_SESSIONS_COLLECTION)
      .updateOne({ _id: opened.sessionId }, { $unset: { client: '' } });

    expect((await rotate(first.tokenHash, 'web')).result.outcome).toBe(
      'rotated',
    );
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
