import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  groupDetailSchema,
  type GroupDetail,
  type GroupMember,
  type UserProfile,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../../auth/application/ports/access-token-signer.port';
import { UsersFacade } from '../../users/application/users.facade';
import { USER_MODEL_NAME } from '../../users/infrastructure/user.schema';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MEMBERS_COLLECTION,
  GROUP_MODEL_NAME,
  GROUPS_COLLECTION,
} from '../infrastructure/group.schemas';

// `POST /api/groups/:id/owner` por HTTP (tareas 3.3, 3.3b y 3.4 de groups-ownership-join-limit) sobre `createApp` con el
// MongoDB del preset, en replica set: la transferencia y el borrado van en transacción. Mismo arnés que
// `groups.controller.spec`: usuarios creados con `UsersFacade` y tokens firmados con el ACCESS_TOKEN_SIGNER de la app.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const MALFORMED_ID = 'no-es-un-id';
/** Repeticiones fijas de cada prueba de concurrencia (D1): solo afirman invariantes, nunca qué rama gana. */
const RACE_REPETITIONS = 10;

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

interface Member {
  readonly profile: UserProfile;
  readonly authorization: string;
}

interface Scene {
  readonly group: GroupDetail;
  readonly ana: Member;
  readonly beto: Member;
  readonly carla: Member;
}

describe('GroupsController ownership transfer', () => {
  let app: NestFastifyApplication;
  let connection: Connection;
  let users: UsersFacade;
  let signer: AccessTokenSigner;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(
        getMongoTestUri(),
        `groups-owner-http-${randomUUID()}`,
      ),
    });
    app = await createApp(config, apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    connection = app.get<Connection>(getConnectionToken());
    await connection.asPromise();
    await connection.model(USER_MODEL_NAME).init();
    await connection.model(GROUP_MODEL_NAME).init();
    await connection.model(GROUP_MEMBER_MODEL_NAME).init();
    users = app.get(UsersFacade, { strict: false });
    signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, { strict: false });
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function authenticated(displayName: string): Promise<Member> {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash: HASH,
      displayName,
    });
    const { accessToken } = await signer.sign({
      userId: profile.id,
      sessionId: randomUUID(),
    });
    return { profile, authorization: `Bearer ${accessToken}` };
  }

  function request(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    options: { authorization?: string; body?: unknown } = {},
  ) {
    return app.inject({
      method,
      url,
      headers: {
        ...(options.authorization === undefined
          ? {}
          : { authorization: options.authorization }),
        ...(options.body === undefined
          ? {}
          : { 'content-type': 'application/json' }),
      },
      ...(options.body === undefined
        ? {}
        : { payload: JSON.stringify(options.body) }),
    });
  }

  function transfer(from: Member, groupId: string, userId: unknown) {
    return request('POST', `/api/groups/${groupId}/owner`, {
      authorization: from.authorization,
      body: { userId },
    });
  }

  /** Grupo de Ana con Beto y Carla, unidos por HTTP con el código de invitación. */
  async function groupOfAnaWithBetoAndCarla(): Promise<Scene> {
    const [ana, beto, carla] = await Promise.all([
      authenticated('Ana'),
      authenticated('Beto'),
      authenticated('Carla'),
    ]);
    const created = await request('POST', '/api/groups', {
      authorization: ana.authorization,
      body: { name: 'Backend Bolivia' },
    });
    expect(created.statusCode).toBe(201);
    const group = created.json<GroupDetail>();
    for (const member of [beto, carla]) {
      const joined = await request('POST', '/api/groups/join', {
        authorization: member.authorization,
        body: { code: group.inviteCode },
      });
      expect(joined.statusCode).toBe(200);
    }
    return { group, ana, beto, carla };
  }

  async function membersOf(
    groupId: string,
    viewer: Member,
  ): Promise<GroupMember[]> {
    const response = await request('GET', `/api/groups/${groupId}/members`, {
      authorization: viewer.authorization,
    });
    expect(response.statusCode).toBe(200);
    return response.json<GroupMember[]>();
  }

  /** Membresías `owner` del grupo, leídas de la colección y no por la API. */
  async function ownersOf(groupId: string): Promise<string[]> {
    const rows = await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .find({ groupId: new mongoose.Types.ObjectId(groupId), role: 'owner' })
      .toArray();
    return rows.map((row) => String(row['userId']));
  }

  async function groupExists(groupId: string): Promise<boolean> {
    const count = await connection
      .collection(GROUPS_COLLECTION)
      .countDocuments({ _id: new mongoose.Types.ObjectId(groupId) });
    return count === 1;
  }

  async function membershipCount(groupId: string): Promise<number> {
    return await connection
      .collection(GROUP_MEMBERS_COLLECTION)
      .countDocuments({ groupId: new mongoose.Types.ObjectId(groupId) });
  }

  function isSuccess(statusCode: number): boolean {
    return statusCode >= 200 && statusCode < 300;
  }

  describe('POST /api/groups/:id/owner', () => {
    it('El owner nombra a otro', async () => {
      const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();
      const before = await membersOf(group.id, ana);

      const response = await transfer(ana, group.id, beto.profile.id);

      expect(response.statusCode).toBe(200);
      const detail = groupDetailSchema.parse(response.json());
      expect(detail).toEqual({
        id: group.id,
        name: 'Backend Bolivia',
        role: 'member',
        memberCount: 3,
        createdAt: group.createdAt,
      });
      expect('inviteCode' in detail).toBe(false);
      const after = await membersOf(group.id, ana);
      expect(
        after.map((member) => [member.userId, member.role, member.joinedAt]),
      ).toEqual(
        before.map((member) => [
          member.userId,
          member.userId === beto.profile.id ? 'owner' : 'member',
          member.joinedAt,
        ]),
      );
      await expect(ownersOf(group.id)).resolves.toEqual([beto.profile.id]);
    });

    it('Un miembro no puede transferir', async () => {
      const { group, ana, beto, carla } = await groupOfAnaWithBetoAndCarla();

      const response = await transfer(beto, group.id, carla.profile.id);

      expect(response.statusCode).toBe(403);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'forbidden',
      });
      await expect(ownersOf(group.id)).resolves.toEqual([ana.profile.id]);
    });

    it.each([
      ['someone who is not a member', 'stranger'],
      ['a malformed user id', 'malformed'],
    ] as const)(
      'Transferir a quien no es miembro: %s',
      async (_case, target) => {
        const { group, ana } = await groupOfAnaWithBetoAndCarla();
        const stranger = await authenticated('Diego');

        const response = await transfer(
          ana,
          group.id,
          target === 'stranger' ? stranger.profile.id : MALFORMED_ID,
        );

        expect(response.statusCode).toBe(404);
        expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
          code: 'member_not_found',
        });
        await expect(ownersOf(group.id)).resolves.toEqual([ana.profile.id]);
      },
    );

    it('Transferirse a sí mismo', async () => {
      const { group, ana } = await groupOfAnaWithBetoAndCarla();

      const response = await transfer(ana, group.id, ana.profile.id);

      expect(response.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'already_owner',
      });
      await expect(ownersOf(group.id)).resolves.toEqual([ana.profile.id]);
    });

    it('answers 404 group_not_found to a stranger, an unknown group and a malformed id', async () => {
      const { group, beto } = await groupOfAnaWithBetoAndCarla();
      const stranger = await authenticated('Diego');

      for (const [who, groupId] of [
        [stranger, group.id],
        [beto, new mongoose.Types.ObjectId().toHexString()],
        [beto, MALFORMED_ID],
      ] as const) {
        const response = await transfer(who, groupId, beto.profile.id);

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ code: 'group_not_found' });
      }
    });

    it.each([
      ['no userId', {}],
      ['an empty userId', { userId: '' }],
      ['a userId that is not a string', { userId: 42 }],
    ])('answers 400 validation_error to %s', async (_case, body) => {
      const { group, ana } = await groupOfAnaWithBetoAndCarla();

      const response = await request('POST', `/api/groups/${group.id}/owner`, {
        authorization: ana.authorization,
        body,
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toEqual({
        code: 'validation_error',
        message: expect.any(String),
        fields: ['userId'],
      });
    });

    it('answers 401 without a token', async () => {
      const response = await request(
        'POST',
        '/api/groups/66e9a0000000000000000001/owner',
        { body: { userId: '66e9a0000000000000000002' } },
      );

      expect(response.statusCode).toBe(401);
    });

    it('keeps the invite code', async () => {
      const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();

      await transfer(ana, group.id, beto.profile.id);

      const detail = await request('GET', `/api/groups/${group.id}`, {
        authorization: beto.authorization,
      });
      expect(detail.json()).toMatchObject({ inviteCode: group.inviteCode });
    });
  });

  describe('after a transfer', () => {
    it('El nuevo owner ve el código y el anterior no', async () => {
      const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();
      await transfer(ana, group.id, beto.profile.id);

      const forBeto = await request('GET', `/api/groups/${group.id}`, {
        authorization: beto.authorization,
      });
      const forAna = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });

      expect(forBeto.statusCode).toBe(200);
      expect(forBeto.json()).toMatchObject({
        role: 'owner',
        inviteCode: group.inviteCode,
      });
      expect(forAna.statusCode).toBe(200);
      const anaDetail = groupDetailSchema.parse(forAna.json());
      expect(anaDetail.role).toBe('member');
      expect('inviteCode' in anaDetail).toBe(false);
    });

    it('El nuevo owner puede expulsar al anterior', async () => {
      const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();
      await transfer(ana, group.id, beto.profile.id);

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/${ana.profile.id}`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(204);
      const members = await membersOf(group.id, beto);
      expect(members.map((member) => member.userId)).not.toContain(
        ana.profile.id,
      );
    });

    it('El antiguo owner sale tras transferir', async () => {
      const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();
      await transfer(ana, group.id, beto.profile.id);

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(204);
      const list = await request('GET', '/api/groups', {
        authorization: ana.authorization,
      });
      expect(list.json()).toEqual([]);
      await expect(ownersOf(group.id)).resolves.toEqual([beto.profile.id]);
    });

    it('the former owner can neither delete the group nor transfer it again', async () => {
      const { group, ana, beto, carla } = await groupOfAnaWithBetoAndCarla();
      await transfer(ana, group.id, beto.profile.id);

      const deletion = await request('DELETE', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });
      const again = await transfer(ana, group.id, carla.profile.id);

      expect(deletion.statusCode).toBe(403);
      expect(again.statusCode).toBe(403);
      await expect(groupExists(group.id)).resolves.toBe(true);
      await expect(ownersOf(group.id)).resolves.toEqual([beto.profile.id]);
    });
  });

  describe('concurrency, asserting only invariants', () => {
    it('Dos transferencias a la vez', async () => {
      for (let round = 0; round < RACE_REPETITIONS; round += 1) {
        const { group, ana, beto, carla } = await groupOfAnaWithBetoAndCarla();

        const [toBeto, toCarla] = await Promise.all([
          transfer(ana, group.id, beto.profile.id),
          transfer(ana, group.id, carla.profile.id),
        ]);

        const owners = await ownersOf(group.id);
        expect(owners).toHaveLength(1);
        const successes = [toBeto, toCarla].filter((response) =>
          isSuccess(response.statusCode),
        );
        // Dos 200 dirían que Beto y Carla son owner a la vez.
        expect(successes.length).toBeLessThanOrEqual(1);
        if (isSuccess(toBeto.statusCode)) {
          expect(owners).toEqual([beto.profile.id]);
        } else if (isSuccess(toCarla.statusCode)) {
          expect(owners).toEqual([carla.profile.id]);
        } else {
          expect(owners).toEqual([ana.profile.id]);
        }
      }
    }, 60_000);

    it('Transferir mientras el elegido se va', async () => {
      for (let round = 0; round < RACE_REPETITIONS; round += 1) {
        const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();

        const [transferred, left] = await Promise.all([
          transfer(ana, group.id, beto.profile.id),
          request('DELETE', `/api/groups/${group.id}/members/me`, {
            authorization: beto.authorization,
          }),
        ]);

        const owners = await ownersOf(group.id);
        expect(owners).toHaveLength(1);
        // Transferir a Beto y que Beto se haya ido dejaría el grupo sin owner.
        expect(
          isSuccess(transferred.statusCode) && isSuccess(left.statusCode),
        ).toBe(false);
        if (isSuccess(transferred.statusCode)) {
          expect(owners).toEqual([beto.profile.id]);
          expect(left.statusCode).toBe(409);
        }
        if (isSuccess(left.statusCode)) {
          expect(owners).toEqual([ana.profile.id]);
          expect(transferred.statusCode).toBe(404);
        }
      }
    }, 60_000);

    it('Borrar mientras se transfiere', async () => {
      for (let round = 0; round < RACE_REPETITIONS; round += 1) {
        const { group, ana, beto } = await groupOfAnaWithBetoAndCarla();

        const [deleted, transferred] = await Promise.all([
          request('DELETE', `/api/groups/${group.id}`, {
            authorization: ana.authorization,
          }),
          transfer(ana, group.id, beto.profile.id),
        ]);

        // O el grupo se borró entero, o sigue con un único owner.
        if (await groupExists(group.id)) {
          await expect(ownersOf(group.id)).resolves.toHaveLength(1);
        } else {
          await expect(membershipCount(group.id)).resolves.toBe(0);
        }
        // Borrar y transferir no pueden haber salido bien los dos.
        expect(
          isSuccess(deleted.statusCode) && isSuccess(transferred.statusCode),
        ).toBe(false);
        if (isSuccess(deleted.statusCode)) {
          await expect(groupExists(group.id)).resolves.toBe(false);
        }
        if (isSuccess(transferred.statusCode)) {
          await expect(ownersOf(group.id)).resolves.toEqual([beto.profile.id]);
        }
      }
    }, 60_000);
  });
});
