import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisFixedWindowCounter } from '../../../infrastructure/limits/redis-fixed-window-counter';
import { createRedisAppClient } from '../../../infrastructure/redis/redis-app-client';
import {
  createGroupsJoinTestApp,
  type GroupsJoinTestApp,
  type InjectResponse,
  type JoinTestMember,
} from '../../../test-support/groups-join-test-app';
import {
  JOIN_ATTEMPTS_PER_IP,
  JOIN_ATTEMPTS_PER_USER,
  MAX_MEMBERS_PER_GROUP,
} from '../domain/limits';
import { sequentialInviteCode } from '../application/testing/groups-test-doubles';
import { GROUP_MEMBERS_COLLECTION } from '../infrastructure/group.schemas';

// Escenarios del "Límite de intentos al unirse" por HTTP (tarea 4.5b de groups-ownership-join-limit), con el arnés de
// 4.5a: el contador de intentos es el doble controlable, y cada test tiene su propia IP por defecto.

/**
 * Códigos con el formato del dominio que ningún grupo de este archivo tiene: los grupos reciben códigos aleatorios, y
 * que uno coincida con estos 40 es del orden de 1 entre 1e10.
 */
const UNKNOWN_CODES = Array.from({ length: 40 }, (_, index) =>
  sequentialInviteCode(1_000_000 + index),
);
const UNKNOWN_CODE = 'A2B3C4D5';

describe('groups join attempt limit', () => {
  let harness: GroupsJoinTestApp;

  beforeAll(async () => {
    harness = await createGroupsJoinTestApp(getMongoTestUri());
  });

  beforeEach(() => {
    harness.nextTest();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** `count` intentos seguidos con códigos desconocidos; devuelve los estados. */
  async function wrongCodes(
    member: JoinTestMember,
    count: number,
    remoteAddress?: string,
  ): Promise<number[]> {
    const statuses: number[] = [];
    for (let index = 0; index < count; index += 1) {
      const response = await harness.join(
        member,
        UNKNOWN_CODES[index % UNKNOWN_CODES.length] ?? UNKNOWN_CODE,
        { remoteAddress },
      );
      statuses.push(response.statusCode);
    }
    return statuses;
  }

  /** `users` usuarios nuevos que agotan cada uno sus 10 intentos desde esa IP, todos con `404`. */
  async function exhaustFrom(users: number, remoteAddress?: string) {
    for (let index = 0; index < users; index += 1) {
      const someone = await harness.authenticated(`Otro ${index}`);
      const statuses = await wrongCodes(
        someone,
        JOIN_ATTEMPTS_PER_USER,
        remoteAddress,
      );
      expect(statuses.every((status) => status === 404)).toBe(true);
    }
  }

  async function inviteCodeOfNewGroup(): Promise<string> {
    const owner = await harness.authenticated('Propietaria');
    const group = await harness.createGroup(owner);
    if (group.inviteCode === undefined) {
      throw new Error('The owner always receives the invite code');
    }
    return group.inviteCode;
  }

  async function isMemberOfAnyGroup(userId: string): Promise<boolean> {
    const count = await harness.connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .countDocuments({ userId: new mongoose.Types.ObjectId(userId) });
    return count > 0;
  }

  function expectTooManyAttempts(response: InjectResponse): void {
    expect(response.statusCode).toBe(429);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'too_many_attempts',
    });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  }

  it('Demasiados códigos incorrectos', async () => {
    const code = await inviteCodeOfNewGroup();
    const ana = await harness.authenticated('Ana');
    const statuses = await wrongCodes(ana, JOIN_ATTEMPTS_PER_USER);
    expect(statuses.every((status) => status === 404)).toBe(true);

    const response = await harness.join(ana, code);

    expectTooManyAttempts(response);
    await expect(isMemberOfAnyGroup(ana.userId)).resolves.toBe(false);
  });

  it('Los códigos válidos no cuentan', async () => {
    const ana = await harness.authenticated('Ana');
    const group = await harness.createGroup(ana);

    const statuses: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      statuses.push(
        (await harness.join(ana, group.inviteCode ?? '')).statusCode,
      );
    }

    expect(statuses.every((status) => status === 200)).toBe(true);
  });

  it('Un grupo completo no gasta intentos', async () => {
    const owner = await harness.authenticated('Propietaria');
    const group = await harness.createGroup(owner);
    await harness.connection.collection(GROUP_MEMBERS_COLLECTION).insertMany(
      Array.from({ length: MAX_MEMBERS_PER_GROUP - 1 }, () => ({
        groupId: new mongoose.Types.ObjectId(group.id),
        userId: new mongoose.Types.ObjectId(),
        role: 'member',
        joinedAt: new Date(),
      })),
    );
    const ana = await harness.authenticated('Ana');

    const responses: InjectResponse[] = [];
    for (let index = 0; index < 15; index += 1) {
      responses.push(await harness.join(ana, group.inviteCode ?? ''));
    }

    for (const response of responses) {
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'group_full' });
    }
  });

  it('Un código válido no reinicia la cuenta', async () => {
    const code = await inviteCodeOfNewGroup();
    const ana = await harness.authenticated('Ana');
    await wrongCodes(ana, JOIN_ATTEMPTS_PER_USER - 1);

    const joined = await harness.join(ana, code);
    const wrong = await harness.join(ana, UNKNOWN_CODE);
    const next = await harness.join(ana, code);

    expect(joined.statusCode).toBe(200);
    expect(wrong.statusCode).toBe(404);
    expect(wrong.json()).toMatchObject({ code: 'invalid_invite_code' });
    expectTooManyAttempts(next);
  });

  it('Los mal formados también cuentan', async () => {
    const code = await inviteCodeOfNewGroup();
    const ana = await harness.authenticated('Ana');
    for (let index = 0; index < JOIN_ATTEMPTS_PER_USER; index += 1) {
      expect((await harness.join(ana, 'ABC-12')).statusCode).toBe(404);
    }

    expectTooManyAttempts(await harness.join(ana, code));
  });

  it('Límite por IP', async () => {
    const code = await inviteCodeOfNewGroup();
    await exhaustFrom(JOIN_ATTEMPTS_PER_IP / JOIN_ATTEMPTS_PER_USER);
    const ana = await harness.authenticated('Ana');

    const response = await harness.join(ana, code);

    expectTooManyAttempts(response);
    await expect(isMemberOfAnyGroup(ana.userId)).resolves.toBe(false);
  });

  it('Un usuario bloqueado no gasta intentos de la IP', async () => {
    const ana = await harness.authenticated('Ana');
    await wrongCodes(ana, JOIN_ATTEMPTS_PER_USER);
    await exhaustFrom(8);

    const blocked = await wrongCodes(ana, 20);

    expect(blocked.every((status) => status === 429)).toBe(true);
    const beto = await harness.authenticated('Beto');
    const responses: InjectResponse[] = [];
    for (let index = 0; index < 10; index += 1) {
      responses.push(await harness.join(beto, UNKNOWN_CODES[index] ?? ''));
    }
    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'invalid_invite_code' });
    }
  });

  it('El bloqueo de la IP no gasta intentos del usuario', async () => {
    await exhaustFrom(JOIN_ATTEMPTS_PER_IP / JOIN_ATTEMPTS_PER_USER);
    const ana = await harness.authenticated('Ana');

    const fromBlockedIp = await wrongCodes(ana, 5);
    const fromAnotherIp = await wrongCodes(
      ana,
      JOIN_ATTEMPTS_PER_USER + 1,
      '192.0.2.77',
    );

    expect(fromBlockedIp.every((status) => status === 429)).toBe(true);
    expect(fromAnotherIp.slice(0, JOIN_ATTEMPTS_PER_USER)).toEqual(
      Array<number>(JOIN_ATTEMPTS_PER_USER).fill(404),
    );
    expect(fromAnotherIp[JOIN_ATTEMPTS_PER_USER]).toBe(429);
  });

  it('Intentos concurrentes', async () => {
    const ana = await harness.authenticated('Ana');

    const responses = await Promise.all(
      UNKNOWN_CODES.slice(0, 30).map((code) => harness.join(ana, code)),
    );

    const resolved = responses.filter(
      (response) => response.statusCode === 404,
    );
    const limited = responses.filter((response) => response.statusCode === 429);
    expect(resolved.length).toBeLessThanOrEqual(JOIN_ATTEMPTS_PER_USER);
    expect(resolved.length + limited.length).toBe(30);
  });
});

describe('groups join attempt limit with the counter store down', () => {
  const client = createRedisAppClient('redis://127.0.0.1:1');
  const warnings: string[] = [];
  let harness: GroupsJoinTestApp;

  beforeAll(async () => {
    // Sin listener, ioredis escribiría cada reintento por consola; el cliente nunca llega a conectar.
    client.on('error', () => undefined);
    const counter = new RedisFixedWindowCounter(client, {
      warn: (message) => warnings.push(message),
      log: () => undefined,
    });
    harness = await createGroupsJoinTestApp(getMongoTestUri(), { counter });
    harness.nextTest();
  });

  afterAll(async () => {
    client.disconnect();
    await harness.close();
  });

  it('Almacén de contadores caído', async () => {
    const owner = await harness.authenticated('Propietaria');
    const first = await harness.createGroup(owner, 'Uno');
    const second = await harness.createGroup(owner, 'Dos');
    const ana = await harness.authenticated('Ana');

    const responses = [
      await harness.join(ana, first.inviteCode ?? ''),
      await harness.join(ana, second.inviteCode ?? ''),
    ];

    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect(warnings.length).toBeLessThanOrEqual(1);
    for (const warning of warnings) {
      expect(warning).not.toContain(ana.userId);
      expect(warning).not.toContain(first.inviteCode ?? '');
      expect(warning).not.toContain(second.inviteCode ?? '');
    }
  });
});
