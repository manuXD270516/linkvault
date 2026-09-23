import { randomUUID } from 'node:crypto';
import { RUN_TASK, type RunTaskFn } from '@linkvault/ai';
import type { GroupDetail } from '@linkvault/shared';
import type { Type } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { expect } from 'vitest';
import { AppModule } from '../app/app.module';
import { configureApp } from '../app/create-app';
import {
  FIXED_WINDOW_COUNTER,
  type FixedWindowCounter,
} from '../infrastructure/limits/fixed-window-counter';
import { buildLoggerParams } from '../infrastructure/logging/logger-params';
import { InMemoryFixedWindowCounter } from '../infrastructure/limits/testing/in-memory-fixed-window-counter';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from '../modules/auth/application/ports/access-token-signer.port';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
} from '../modules/groups/infrastructure/group.schemas';
import {
  GROUP_LINK_COMMENT_REPOSITORY,
  type GroupLinkCommentRepository,
} from '../modules/links/application/ports/group-link-comment-repository.port';
import { GROUP_LINK_COMMENT_MODEL_NAME } from '../modules/links/infrastructure/group-link-comment.schemas';
import {
  GROUP_LINK_MODEL_NAME,
  JOB_LINK_MODEL_NAME,
  USER_LINK_MODEL_NAME,
} from '../modules/links/infrastructure/link.schemas';
import { UsersFacade } from '../modules/users/application/users.facade';
import { USER_MODEL_NAME } from '../modules/users/infrastructure/user.schema';
import { apiTestAiConfig, apiTestConfig } from './test-config';

// App completa de `api` para los tests de integración HTTP de `links` (D10 de job-links): el `AppModule` real con una
// base de datos propia por archivo. Los usuarios se crean con `UsersFacade` y el access token se firma con el
// ACCESS_TOKEN_SIGNER de la app, como en `groups.controller.spec`: estos tests no pasan por `/auth`.
//
// La URI del replica set la pasa quien llama (`getMongoTestUri()`): este archivo no es un spec, así que no puede
// depender de `@linkvault/testing`, que es una librería de tests.
//
// El **contador de intentos** se sustituye por el de memoria: esta suite no levanta Redis (ADR-021 §4) y el límite de
// relecturas falla cerrado a propósito, así que con el contador real ningún reintento llegaría a probarse. La política
// de fallo se prueba aparte, en el adaptador de `links`, con un contador que sí deja de responder.

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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    options?: {
      authorization?: string;
      body?: unknown;
      /** Cabeceras extra de la petición: las usan los tests que comprueban que la respuesta NO depende de ellas. */
      headers?: Record<string, string>;
    },
  ): Promise<InjectResponse>;
  /** Grupo recién creado por su owner, por HTTP. */
  createGroup(owner: TestMember, name?: string): Promise<GroupDetail>;
  /** Une a `member` al grupo con el código que solo ve su owner. */
  join(member: TestMember, group: GroupDetail): Promise<void>;
  close(): Promise<void>;
}

/**
 * Sustituciones para los tests que necesitan otra cosa que la app tal cual:
 * - `runTask`: un doble de `RUN_TASK` para los escenarios en que la IA degrada o agota su cuota. Sin él, `runTask` es el
 *   mock en `replay` con los fixtures grabados; nunca `synth`.
 * - `counter`: otro contador de intentos, para simular uno caído o una ventana agotada.
 * - `logDestination`: adónde van los logs, a nivel `debug`, para comprobar qué **no** se registra.
 * - `commentRepository`: otro adaptador de comentarios, para forzar que falle el borrado de comentarios y comprobar que
 *   la transacción se deshace entera (group-comments).
 */
export interface LinksTestAppOptions {
  readonly runTask?: RunTaskFn;
  readonly counter?: FixedWindowCounter;
  readonly logDestination?: DestinationStream;
  readonly commentRepository?: Type<GroupLinkCommentRepository>;
}

export async function createLinksTestApp(
  name: string,
  mongoUri: string,
  options: LinksTestAppOptions = {},
): Promise<LinksTestApp> {
  const config = await apiTestConfig({
    MONGO_URI: withDatabase(mongoUri, `${name}-${randomUUID()}`),
  });
  let builder = Test.createTestingModule({
    imports: [AppModule.register(config, apiTestAiConfig())],
  })
    .overrideProvider(FIXED_WINDOW_COUNTER)
    .useValue(options.counter ?? new InMemoryFixedWindowCounter());
  if (options.runTask !== undefined) {
    builder = builder.overrideProvider(RUN_TASK).useValue(options.runTask);
  }
  if (options.commentRepository !== undefined) {
    builder = builder
      .overrideProvider(GROUP_LINK_COMMENT_REPOSITORY)
      .useClass(options.commentRepository);
  }
  if (options.logDestination !== undefined) {
    builder = builder
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue(
        buildLoggerParams({ LOG_LEVEL: 'debug' }, options.logDestination),
      );
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));
  await configureApp(app, {
    extensionCorsOrigins: config.EXTENSION_CORS_ORIGINS,
  });
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
    GROUP_LINK_COMMENT_MODEL_NAME,
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
        ...(options.headers ?? {}),
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
