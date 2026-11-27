import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateRefreshToken } from '../application/refresh-token';
import type { Clock } from '../domain/clock';
import { RefreshSessionPolicy } from '../domain/refresh-session';
import {
  MongoSessionRepository,
  type RotationProbe,
} from './mongo-session.repository';
import {
  AUTH_SESSION_MODEL_NAME,
  REFRESH_TOKEN_MODEL_NAME,
  REFRESH_TOKENS_COLLECTION,
} from './session.schemas';

// Invariante de D3 de session-refresh-abort: una vez usado un token de una generación, la sesión tiene como mucho una
// hoja viva por cadena. Se intercalan dos transacciones de forma determinista en los dos órdenes con la pausa
// inyectable `rotationProbe` (solo tests) y, como complemento, con una carrera repetida.

const SECOND = 1_000;
const NOW = new Date('2026-09-17T10:00:00.000Z');
const PAUSE_TIMEOUT_MS = 10_000;

class MovableClock implements Clock {
  current = NOW;

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Pausa la primera lectura del tipo indicado hasta que el test la suelte; las demás pasan sin esperar. */
class PauseOnce implements RotationProbe {
  private release!: () => void;
  private reachedSignal!: () => void;
  private paused = false;
  readonly reached = new Promise<void>((resolve) => {
    this.reachedSignal = resolve;
  });
  private readonly gate = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  constructor(private readonly kind: 'rotate' | 'reissue') {}

  async afterRead(kind: 'rotate' | 'reissue'): Promise<void> {
    if (kind !== this.kind || this.paused) {
      return;
    }
    this.paused = true;
    this.reachedSignal();
    await this.gate;
  }

  open(): void {
    this.release();
  }
}

/** Falla en lugar de colgarse si la pausa nunca se alcanza. */
function within<T>(promise: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Timed out waiting for ${what}`)),
        PAUSE_TIMEOUT_MS,
      ),
    ),
  ]);
}

let connection: Connection;
let clock: MovableClock;
let policy: RefreshSessionPolicy;
let repository: MongoSessionRepository;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `interleaving-${randomUUID()}`,
    })
    .asPromise();
  clock = new MovableClock();
  policy = new RefreshSessionPolicy(clock, {
    refreshTtlDays: 30,
    refreshMaxDays: 90,
  });
  repository = new MongoSessionRepository(connection, policy, clock);
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

function rotateWith(repo: MongoSessionRepository, tokenHash: string) {
  const successor = generateRefreshToken();
  return repo
    .rotate({
      tokenHash,
      successorHash: successor.tokenHash,
      expectedClient: 'web',
    })
    .then((result) => ({ result, successorHash: successor.tokenHash }));
}

async function openSession() {
  const first = generateRefreshToken();
  const opened = await repository.open(`user-${randomUUID()}`, first.tokenHash);
  return { ...opened, tokenHash: first.tokenHash };
}

function liveLeaves(sessionId: string): Promise<number> {
  return connection
    .collection(REFRESH_TOKENS_COLLECTION)
    .countDocuments({ sessionId, rotatedAt: null });
}

describe('MongoSessionRepository (interleaved rotation and reissue)', () => {
  it('reissue commits first, then a sibling rotation supersedes the new sibling', async () => {
    const session = await openSession();
    const r2 = await rotateWith(repository, session.tokenHash); // R1 -> R2, sin usar
    clock.advance(2 * SECOND);
    const probe = new PauseOnce('rotate');
    const paused = new MongoSessionRepository(connection, policy, clock, probe);

    // Arranca la rotación de R2 y la pausa justo tras leerlo.
    const rotatingR2 = rotateWith(paused, r2.successorHash);
    await within(probe.reached, 'the paused rotation');
    // Con ella pausada, la reemisión de R1 (R3) corre y confirma.
    const r3 = await rotateWith(repository, session.tokenHash);
    expect(r3.result).toMatchObject({ outcome: 'rotated', reissued: true });
    probe.open();
    const rotated = await rotatingR2;

    expect(rotated.result).toMatchObject({
      outcome: 'rotated',
      reissued: false,
    });
    clock.advance(SECOND);
    expect(
      (await rotateWith(repository, r3.successorHash)).result.outcome,
    ).toBe('conflict');
    // Una sola hoja utilizable: el hijo de R2.
    expect(await liveLeaves(session.sessionId)).toBe(1);
    expect(
      (await rotateWith(repository, rotated.successorHash)).result.outcome,
    ).toBe('rotated');
  });

  it('sibling rotation commits first, then the reissue gets conflict', async () => {
    const session = await openSession();
    const r2 = await rotateWith(repository, session.tokenHash); // R1 -> R2, sin usar
    clock.advance(2 * SECOND);
    const probe = new PauseOnce('reissue');
    const paused = new MongoSessionRepository(connection, policy, clock, probe);

    // Arranca la reemisión de R1 y la pausa tras la lectura.
    const reissuing = rotateWith(paused, session.tokenHash);
    await within(probe.reached, 'the paused reissue');
    // Con ella pausada, la rotación del hermano R2 confirma.
    const rotated = await rotateWith(repository, r2.successorHash);
    expect(rotated.result.outcome).toBe('rotated');
    probe.open();
    const reissue = await reissuing;

    expect(reissue.result.outcome).toBe('conflict');
    expect(await repository.findRefreshToken(reissue.successorHash)).toBeNull();
    expect(
      await connection
        .collection(REFRESH_TOKENS_COLLECTION)
        .countDocuments({ parentHash: session.tokenHash }),
    ).toBe(1);
    expect(await liveLeaves(session.sessionId)).toBe(1);
  });

  it('Reemisión y uso de un hermano a la vez (20 carreras)', async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      clock.current = NOW;
      const session = await openSession();
      const r2 = await rotateWith(repository, session.tokenHash);
      clock.advance(2 * SECOND);

      const [reissue, used] = await Promise.all([
        rotateWith(repository, session.tokenHash),
        rotateWith(repository, r2.successorHash),
      ]);

      expect(used.result).toMatchObject({ outcome: 'rotated' });
      expect(['conflict', 'rotated']).toContain(reissue.result.outcome);
      // R4 (el hijo de R2) es la única hoja que sigue viva.
      expect(await liveLeaves(session.sessionId)).toBe(1);
      expect(
        await repository.findRefreshToken(used.successorHash),
      ).toMatchObject({ rotatedAt: null });
      clock.advance(SECOND);
      expect(
        (await rotateWith(repository, used.successorHash)).result.outcome,
      ).toBe('rotated');
    }
  }, 60_000);
});
