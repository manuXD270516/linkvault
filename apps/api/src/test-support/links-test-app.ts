import { randomUUID } from 'node:crypto';
import type { GroupDetail } from '@linkvault/shared';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Connection } from 'mongoose';
import { expect } from 'vitest';
import { createApp } from '../app/create-app';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
} from '../modules/groups/infrastructure/group.schemas';
import {
  GROUP_LINK_MODEL_NAME,
  JOB_LINK_MODEL_NAME,
  USER_LINK_MODEL_NAME,
} from '../modules/links/infrastructure/link.schemas';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestConfig } from './test-config';

// App completa de `api` para los tests de integración HTTP de `links` (D10 de job-links): el `AppModule` real con una
// base de datos propia por archivo. Los usuarios se crean con `UsersFacade` y el access token se firma con el
// ACCESS_TOKEN_SIGNER de la app, como en `groups.controller.spec`: estos tests no pasan por `/auth`.
//
// La URI del replica set la pasa quien llama (`getMongoTestUri()`): este archivo no es un spec, así que no puede
// depender de `@linkvault/testing`, que es una librería de tests.

const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA';

export type InjectResponse = Awaited<
  ReturnType<NestFastifyApplication['inject']>
>;

/** Usuario autenticado de un test, con la cabecera lista para usar. */
export interface TestMember {
  readonly userId: string;
  readonly displayName: string;
  readonly authorization: string;
}

export interface LinksTestApp {
  readonly app: NestFastifyApplication;
  readonly connection: Connection;
  /** Usuario nuevo con su access token. */
  authenticated(displayName?: string): Promise<TestMember>;
  request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    options?: { authorization?: string; body?: unknown },
  ): Promise<InjectResponse>;
  /** Grupo recién creado por su owner, por HTTP. */
  createGroup(owner: TestMember, name?: string): Promise<GroupDetail>;
  /** Une a `member` al grupo con el código que solo ve su owner. */
  join(member: TestMember, group: GroupDetail): Promise<void>;
  close(): Promise<void>;
}

export async function createLinksTestApp(
  name: string,
  mongoUri: string,
): Promise<LinksTestApp> {
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `${name}-${randomUUID()}`),
  });
  const app = await createApp(config);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const connection = app.get<Connection>(getConnectionToken());
  await connection.asPromise();
  for (const model of [
    USER_MODEL_NAME,
    GROUP_MODEL_NAME,
    GROUP_MEMBER_MODEL_NAME,
    JOB_LINK_MODEL_NAME,
    GROUP_LINK_MODEL_NAME,
    USER_LINK_MODEL_NAME,
  ]) {
    await connection.model(model).init();
  }
  const users = app.get(UsersFacade, { strict: false });
  const signer = app.get<AccessTokenSigner>(ACCESS_TOKEN_SIGNER, {
    strict: false,
  });

  const request: LinksTestApp['request'] = (method, url, options = {}) =>
    app.inject({
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

  const authenticated = async (displayName = 'Ana'): Promise<TestMember> => {
    const profile = await users.createWithPassword({
      email: `${randomUUID()}@example.com`,
      passwordHash: HASH,
      displayName,
    });
    const { accessToken } = await signer.sign({
      userId: profile.id,
      sessionId: randomUUID(),
    });
    return {
      userId: profile.id,
      displayName,
      authorization: `Bearer ${accessToken}`,
    };
  };

  const createGroup = async (
    owner: TestMember,
    groupName = 'Backend Bolivia',
  ): Promise<GroupDetail> => {
    const response = await request('POST', '/api/groups', {
      authorization: owner.authorization,
      body: { name: groupName },
    });
    expect(response.statusCode).toBe(201);
    return response.json<GroupDetail>();
  };

  const join = async (
    member: TestMember,
    group: GroupDetail,
  ): Promise<void> => {
    if (group.inviteCode === undefined) {
      throw new Error('The owner always receives the invite code');
    }
    const response = await request('POST', '/api/groups/join', {
      authorization: member.authorization,
      body: { code: group.inviteCode },
    });
    expect(response.statusCode).toBe(200);
  };

  return {
    app,
    connection,
    authenticated,
    request,
    createGroup,
    join,
    async close() {
      await connection.dropDatabase();
      await app.close();
    },
  };
}

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}
