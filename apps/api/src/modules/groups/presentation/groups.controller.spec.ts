import { randomUUID } from 'node:crypto';
import {
  apiErrorResponseSchema,
  groupDetailSchema,
  groupMemberSchema,
  groupSummarySchema,
  inviteCodeResponseSchema,
  type GroupDetail,
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
import { isValidInviteCode } from '../domain/invite-code';
import { MAX_GROUPS_PER_USER, MAX_MEMBERS_PER_GROUP } from '../domain/limits';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MEMBERS_COLLECTION,
  GROUP_MODEL_NAME,
} from '../infrastructure/group.schemas';

// Endpoints de `/api/groups` (tareas 5.1 a 5.4 de groups) sobre `createApp` con el MongoDB del preset. Los usuarios se
// crean con `UsersFacade` y el access token se firma con el ACCESS_TOKEN_SIGNER de la app, como en `users.controller.spec`:
// estos tests no dependen de `/auth/register`.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';
const MALFORMED_ID = 'no-es-un-id';

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

interface Member {
  readonly profile: UserProfile;
  readonly authorization: string;
}

describe('GroupsController', () => {
  let app: NestFastifyApplication;
  let users: UsersFacade;
  let signer: AccessTokenSigner;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(getMongoTestUri(), `groups-http-${randomUUID()}`),
    });
    app = await createApp(config, apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const connection = app.get<Connection>(getConnectionToken());
    await connection.asPromise();
    await connection.model(USER_MODEL_NAME).init();
    await connection.model(GROUP_MODEL_NAME).init();
    await connection.model(GROUP_MEMBER_MODEL_NAME).init();
    users = app.get(UsersFacade, { strict: false });
    signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, { strict: false });
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  /** Usuario nuevo con su access token. */
  async function authenticated(displayName = 'Ana'): Promise<Member> {
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
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
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

  /** Grupo recién creado por `owner`. */
  async function createGroup(
    owner: Member,
    name = 'Backend Bolivia',
  ): Promise<GroupDetail> {
    const response = await request('POST', '/api/groups', {
      authorization: owner.authorization,
      body: { name },
    });
    expect(response.statusCode).toBe(201);
    return response.json<GroupDetail>();
  }

  /** Código de invitación del grupo, que solo ve su owner. */
  function inviteCodeOf(group: GroupDetail): string {
    if (group.inviteCode === undefined) {
      throw new Error('The owner always receives the invite code');
    }
    return group.inviteCode;
  }

  async function joinWith(member: Member, code: string) {
    return await request('POST', '/api/groups/join', {
      authorization: member.authorization,
      body: { code },
    });
  }

  /**
   * Llena el grupo con membresías de usuarios que no existen, escribiendo directamente en la colección: crear 49 cuentas
   * y unirlas por HTTP solo alargaría el test, y lo que se prueba es el límite, no el alta.
   */
  async function fillWithMembers(groupId: string, count: number) {
    const connection = app.get<Connection>(getConnectionToken());
    await connection.collection(GROUP_MEMBERS_COLLECTION).insertMany(
      Array.from({ length: count }, () => ({
        groupId: new mongoose.Types.ObjectId(groupId),
        userId: new mongoose.Types.ObjectId(),
        role: 'member',
        joinedAt: new Date(),
      })),
    );
  }

  describe('access', () => {
    it.each([
      ['POST', '/api/groups', { name: 'Sin token' }],
      ['GET', '/api/groups', undefined],
      ['POST', '/api/groups/join', { code: 'A2B3C4D5' }],
      ['GET', '/api/groups/66e9a0000000000000000001', undefined],
      ['PATCH', '/api/groups/66e9a0000000000000000001', { name: 'Otro' }],
      ['DELETE', '/api/groups/66e9a0000000000000000001', undefined],
      ['POST', '/api/groups/66e9a0000000000000000001/invite-code', undefined],
      ['GET', '/api/groups/66e9a0000000000000000001/members', undefined],
      ['DELETE', '/api/groups/66e9a0000000000000000001/members/me', undefined],
      [
        'DELETE',
        '/api/groups/66e9a0000000000000000001/members/66e9a0000000000000000002',
        undefined,
      ],
    ] as const)(
      'answers 401 to %s %s without a token',
      async (method, url, body) => {
        const response = await request(method, url, { body });

        expect(response.statusCode).toBe(401);
        expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
          code: 'unauthorized',
        });
      },
    );

    it('answers 401 with a token that is not an access token', async () => {
      const response = await request('GET', '/api/groups', {
        authorization: 'Bearer not-a-token',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('the ten routes are wired', () => {
    it('answers every path with the endpoint and not with the 404 of an unknown route', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'Rutas');
      const authorization = ana.authorization;

      const responses = [
        await request('GET', '/api/groups', { authorization }),
        await request('GET', `/api/groups/${group.id}`, { authorization }),
        await request('PATCH', `/api/groups/${group.id}`, {
          authorization,
          body: { name: 'Rutas 2' },
        }),
        await request('POST', `/api/groups/${group.id}/invite-code`, {
          authorization,
        }),
        await request('GET', `/api/groups/${group.id}/members`, {
          authorization,
        }),
        await request('DELETE', `/api/groups/${group.id}/members/me`, {
          authorization,
        }),
        await request(
          'DELETE',
          `/api/groups/${group.id}/members/${ana.profile.id}`,
          { authorization },
        ),
        await joinWith(ana, inviteCodeOf(group)),
        await request('DELETE', `/api/groups/${group.id}`, { authorization }),
      ];

      // El 404 de una ruta desconocida lleva `Cannot <MÉTODO> <ruta>`; el de un grupo ajeno, `group_not_found`.
      for (const response of responses) {
        expect(response.body).not.toContain('Cannot ');
      }
      expect(responses.at(-1)?.statusCode).toBe(204);
    });
  });

  describe('POST /api/groups', () => {
    it('Grupo creado', async () => {
      const ana = await authenticated();

      const response = await request('POST', '/api/groups', {
        authorization: ana.authorization,
        body: { name: '  Backend Bolivia ' },
      });

      expect(response.statusCode).toBe(201);
      const group = groupDetailSchema.parse(response.json());
      expect(group).toEqual({
        id: expect.any(String),
        name: 'Backend Bolivia',
        role: 'owner',
        memberCount: 1,
        createdAt: expect.any(String),
        inviteCode: expect.any(String),
      });
      expect(isValidInviteCode(inviteCodeOf(group))).toBe(true);
      const members = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: ana.authorization,
      });
      expect(members.json()).toEqual([
        {
          userId: ana.profile.id,
          displayName: 'Ana',
          role: 'owner',
          joinedAt: expect.any(String),
        },
      ]);
    });

    it('Nombre inválido', async () => {
      const ana = await authenticated();

      const response = await request('POST', '/api/groups', {
        authorization: ana.authorization,
        body: { name: '   ' },
      });

      expect(response.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(response.json())).toEqual({
        code: 'validation_error',
        message: expect.any(String),
        fields: ['name'],
      });
    });
  });

  describe('GET /api/groups', () => {
    it('Lista con rol', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const own = await createGroup(ana, 'Propio');
      const other = await createGroup(beto, 'De Beto');
      expect((await joinWith(ana, inviteCodeOf(other))).statusCode).toBe(200);

      const response = await request('GET', '/api/groups', {
        authorization: ana.authorization,
      });

      expect(response.statusCode).toBe(200);
      const groups = response
        .json<unknown[]>()
        .map((group) => groupSummarySchema.parse(group));
      expect(groups).toEqual([
        {
          id: other.id,
          name: 'De Beto',
          role: 'member',
          memberCount: 2,
          joinedAt: expect.any(String),
        },
        {
          id: own.id,
          name: 'Propio',
          role: 'owner',
          memberCount: 1,
          joinedAt: expect.any(String),
        },
      ]);
      // Ningún grupo de la lista lleva el código de invitación, tampoco el propio.
      expect(response.body).not.toContain(inviteCodeOf(own));
      expect(response.body).not.toContain(inviteCodeOf(other));
    });

    it('Sin grupos', async () => {
      const nadie = await authenticated('Nadie');

      const response = await request('GET', '/api/groups', {
        authorization: nadie.authorization,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    });
  });

  describe('GET /api/groups/:id', () => {
    it('Detalle para el owner', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'Detalle');

      const response = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });

      expect(response.statusCode).toBe(200);
      expect(groupDetailSchema.parse(response.json())).toEqual({
        ...group,
        inviteCode: inviteCodeOf(group),
      });
    });

    it('Detalle para un miembro', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Detalle de miembro');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request('GET', `/api/groups/${group.id}`, {
        authorization: beto.authorization,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        id: group.id,
        name: 'Detalle de miembro',
        role: 'member',
        memberCount: 2,
        createdAt: group.createdAt,
      });
      expect(response.body).not.toContain(inviteCodeOf(group));
    });

    it('Grupo ajeno indistinguible de uno inexistente', async () => {
      const ana = await authenticated();
      const carla = await authenticated('Carla');
      const group = await createGroup(ana, 'Ajeno');

      const responses = [
        await request('GET', `/api/groups/${group.id}`, {
          authorization: carla.authorization,
        }),
        await request('GET', `/api/groups/66e9a00000000000000000ff`, {
          authorization: carla.authorization,
        }),
        await request('GET', `/api/groups/${MALFORMED_ID}`, {
          authorization: carla.authorization,
        }),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(404);
        expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
          code: 'group_not_found',
        });
      }
      // Cuerpos idénticos: un extraño no puede distinguir los tres casos.
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    });
  });

  describe('PATCH /api/groups/:id', () => {
    it('El owner renombra', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'Backend Bolivia');

      const response = await request('PATCH', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
        body: { name: ' Backend LatAm ' },
      });

      expect(response.statusCode).toBe(200);
      expect(groupDetailSchema.parse(response.json())).toMatchObject({
        id: group.id,
        name: 'Backend LatAm',
        role: 'owner',
      });
    });

    it('Un miembro no puede renombrar', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Backend Bolivia');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request('PATCH', `/api/groups/${group.id}`, {
        authorization: beto.authorization,
        body: { name: 'Mío ahora' },
      });

      expect(response.statusCode).toBe(403);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'forbidden',
      });
      const after = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });
      expect(after.json<GroupDetail>().name).toBe('Backend Bolivia');
    });

    it('answers 400 naming name to an invalid rename', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'Backend Bolivia');

      const response = await request('PATCH', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
        body: { name: 'a'.repeat(61) },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 'validation_error',
        fields: ['name'],
      });
    });
  });

  describe('POST /api/groups/:id/invite-code', () => {
    it('Regenerar el código', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Rotación');

      const response = await request(
        'POST',
        `/api/groups/${group.id}/invite-code`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(200);
      const { inviteCode } = inviteCodeResponseSchema.parse(response.json());
      expect(inviteCode).not.toBe(inviteCodeOf(group));
      // Unirse con el código anterior deja de funcionar; con el nuevo, sí.
      const withOld = await joinWith(beto, inviteCodeOf(group));
      expect(withOld.statusCode).toBe(404);
      expect(withOld.json()).toMatchObject({ code: 'invalid_invite_code' });
      expect((await joinWith(beto, inviteCode)).statusCode).toBe(200);
    });

    it('Un miembro no puede regenerar', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Rotación ajena');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request(
        'POST',
        `/api/groups/${group.id}/invite-code`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'forbidden' });
    });
  });

  describe('DELETE /api/groups/:id', () => {
    it('El owner borra el grupo', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Para borrar');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request('DELETE', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      for (const member of [ana, beto]) {
        const list = await request('GET', '/api/groups', {
          authorization: member.authorization,
        });
        expect(list.json()).toEqual([]);
      }
      const rejoin = await joinWith(beto, inviteCodeOf(group));
      expect(rejoin.statusCode).toBe(404);
      expect(rejoin.json()).toMatchObject({ code: 'invalid_invite_code' });
    });

    it('Un miembro no puede borrar', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'No se borra');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request('DELETE', `/api/groups/${group.id}`, {
        authorization: beto.authorization,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'forbidden' });
      expect(
        (
          await request('GET', `/api/groups/${group.id}`, {
            authorization: ana.authorization,
          })
        ).statusCode,
      ).toBe(200);
    });
  });

  describe('POST /api/groups/join', () => {
    it('Unirse por código', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Se une Beto');

      const response = await joinWith(
        beto,
        `  ${inviteCodeOf(group).toLowerCase()} `,
      );

      expect(response.statusCode).toBe(200);
      expect(groupSummarySchema.parse(response.json())).toEqual({
        id: group.id,
        name: 'Se une Beto',
        role: 'member',
        memberCount: 2,
        joinedAt: expect.any(String),
      });
      // La respuesta de unión nunca lleva el código de invitación.
      expect(response.body).not.toContain(inviteCodeOf(group));
      const list = await request('GET', '/api/groups', {
        authorization: beto.authorization,
      });
      expect(list.json<{ id: string }[]>().map((item) => item.id)).toEqual([
        group.id,
      ]);
    });

    it('Código desconocido', async () => {
      const beto = await authenticated('Beto');

      const response = await joinWith(beto, 'A2B3C4D5');

      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'invalid_invite_code',
      });
    });

    it('Código con formato inválido', async () => {
      const beto = await authenticated('Beto');

      const unknown = await joinWith(beto, 'A2B3C4D5');
      const malformed = await joinWith(beto, 'ABC-12');

      expect(malformed.statusCode).toBe(404);
      // Mismo cuerpo que un código desconocido: no se distinguen.
      expect(malformed.body).toBe(unknown.body);
    });

    it('Unirse dos veces', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Dos veces');
      const first = await joinWith(beto, inviteCodeOf(group));

      const again = await joinWith(beto, inviteCodeOf(group));

      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());
      const members = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: ana.authorization,
      });
      expect(members.json<unknown[]>()).toHaveLength(2);
    });

    it('El owner se une a su propio grupo', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'Propio código');

      const response = await joinWith(ana, inviteCodeOf(group));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ role: 'owner', memberCount: 1 });
      expect(response.body).not.toContain(inviteCodeOf(group));
    });

    it('Grupo completo', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Completo');
      await fillWithMembers(group.id, MAX_MEMBERS_PER_GROUP - 1);

      const response = await joinWith(beto, inviteCodeOf(group));

      expect(response.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'group_full',
      });
      const detail = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });
      expect(detail.json<GroupDetail>().memberCount).toBe(
        MAX_MEMBERS_PER_GROUP,
      );
    });

    it('Límite alcanzado al unirse', async () => {
      const ana = await authenticated();
      const lleno = await authenticated('Lleno');
      const group = await createGroup(ana, 'Uno más');
      for (let index = 0; index < MAX_GROUPS_PER_USER; index += 1) {
        await createGroup(lleno, `Grupo ${index}`);
      }

      const response = await joinWith(lleno, inviteCodeOf(group));

      expect(response.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'too_many_groups',
      });
      const members = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: ana.authorization,
      });
      expect(members.json<unknown[]>()).toHaveLength(1);
    });
  });

  describe('GET /api/groups/:id/members', () => {
    it('Un miembro ve la lista', async () => {
      const ana = await authenticated('Ana');
      const beto = await authenticated('Beto');
      const carla = await authenticated('Carla');
      const group = await createGroup(ana, 'Con miembros');
      await joinWith(beto, inviteCodeOf(group));
      await joinWith(carla, inviteCodeOf(group));

      const response = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: beto.authorization,
      });

      expect(response.statusCode).toBe(200);
      const members = response
        .json<unknown[]>()
        .map((member) => groupMemberSchema.parse(member));
      expect(members).toEqual([
        {
          userId: ana.profile.id,
          displayName: 'Ana',
          role: 'owner',
          joinedAt: expect.any(String),
        },
        {
          userId: beto.profile.id,
          displayName: 'Beto',
          role: 'member',
          joinedAt: expect.any(String),
        },
        {
          userId: carla.profile.id,
          displayName: 'Carla',
          role: 'member',
          joinedAt: expect.any(String),
        },
      ]);
    });

    it('Un tercero no ve el perfil', async () => {
      const ana = await authenticated('Ana');
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Sin emails');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: beto.authorization,
      });

      // Ni el email de nadie ni ningún otro dato de contacto: la lista solo lleva nombre, rol y fecha de alta.
      expect(response.body).not.toContain('@');
      expect(response.body).not.toContain(ana.profile.email);
      expect(response.body).not.toContain('aiConsent');
    });

    it('Un extraño no ve la lista', async () => {
      const ana = await authenticated();
      const diego = await authenticated('Diego');
      const group = await createGroup(ana, 'Lista ajena');

      const response = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: diego.authorization,
      });

      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'group_not_found',
      });
    });
  });

  describe('DELETE /api/groups/:id/members/me', () => {
    it('Un miembro sale', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Se sale Beto');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(204);
      expect(response.body).toBe('');
      const list = await request('GET', '/api/groups', {
        authorization: beto.authorization,
      });
      expect(list.json()).toEqual([]);
      const detail = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });
      expect(detail.json<GroupDetail>().memberCount).toBe(1);
    });

    it('El owner no puede salir', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'El owner se queda');

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'owner_cannot_leave',
      });
      const detail = await request('GET', `/api/groups/${group.id}`, {
        authorization: ana.authorization,
      });
      expect(detail.json<GroupDetail>().role).toBe('owner');
    });

    it('answers 404 group_not_found to someone who is not a member', async () => {
      const ana = await authenticated();
      const diego = await authenticated('Diego');
      const group = await createGroup(ana, 'Salida ajena');

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: diego.authorization },
      );

      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ code: 'group_not_found' });
    });
  });

  describe('DELETE /api/groups/:id/members/:userId', () => {
    it('El owner expulsa', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const group = await createGroup(ana, 'Expulsión');
      await joinWith(beto, inviteCodeOf(group));

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/${beto.profile.id}`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(204);
      expect(
        (
          await request('GET', '/api/groups', {
            authorization: beto.authorization,
          })
        ).json(),
      ).toEqual([]);
      // Con el código vigente puede volver a entrar: por eso la UI ofrece regenerarlo tras expulsar.
      const rejoin = await joinWith(beto, inviteCodeOf(group));
      expect(rejoin.statusCode).toBe(200);
      expect(rejoin.json()).toMatchObject({ id: group.id, role: 'member' });
    });

    it('Un miembro no puede expulsar', async () => {
      const ana = await authenticated();
      const beto = await authenticated('Beto');
      const carla = await authenticated('Carla');
      const group = await createGroup(ana, 'Expulsión entre miembros');
      await joinWith(beto, inviteCodeOf(group));
      await joinWith(carla, inviteCodeOf(group));

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/${carla.profile.id}`,
        { authorization: beto.authorization },
      );

      expect(response.statusCode).toBe(403);
      expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
        code: 'forbidden',
      });
      const members = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: ana.authorization,
      });
      expect(members.json<unknown[]>()).toHaveLength(3);
    });

    it('Expulsar a quien no es miembro', async () => {
      const ana = await authenticated();
      const diego = await authenticated('Diego');
      const group = await createGroup(ana, 'Expulsar a un extraño');

      const responses = [
        await request(
          'DELETE',
          `/api/groups/${group.id}/members/${diego.profile.id}`,
          { authorization: ana.authorization },
        ),
        await request(
          'DELETE',
          `/api/groups/${group.id}/members/${MALFORMED_ID}`,
          { authorization: ana.authorization },
        ),
      ];

      for (const response of responses) {
        expect(response.statusCode).toBe(404);
        expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
          code: 'member_not_found',
        });
      }
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    });

    it('answers 409 owner_cannot_leave to the owner removing himself', async () => {
      const ana = await authenticated();
      const group = await createGroup(ana, 'El owner no se expulsa');

      const response = await request(
        'DELETE',
        `/api/groups/${group.id}/members/${ana.profile.id}`,
        { authorization: ana.authorization },
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'owner_cannot_leave' });
      const members = await request('GET', `/api/groups/${group.id}/members`, {
        authorization: ana.authorization,
      });
      expect(members.json<{ role: string }[]>()).toEqual([
        expect.objectContaining({ role: 'owner' }),
      ]);
    });
  });
});
