import { randomUUID } from 'node:crypto';
import {
  AiModule,
  parseAiConfig,
  RUN_TASK,
  type AiConfig,
} from '@linkvault/ai';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { ModulesContainer } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../../../app/app.module';
import { createApp } from '../../../app/create-app';
import { MongoOutbox } from '../../../infrastructure/outbox/mongo-outbox';
import {
  apiTestAiConfig,
  apiTestConfig,
  workspaceRoot,
} from '../../../test-support/test-config';
import { ImportLinks } from '../application/import-links.usecase';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { LINKS_CLOCK } from '../application/ports/clock.port';
import { GROUP_LINK_REPOSITORY } from '../application/ports/group-link-repository.port';
import { GROUP_MEMBERSHIP } from '../application/ports/group-membership.port';
import { JOB_LINK_REPOSITORY } from '../application/ports/job-link-repository.port';
import { LINK_USER_DIRECTORY } from '../application/ports/link-user-directory.port';
import { OUTBOX } from '../application/ports/outbox.port';
import { PASTED_EXTRACTION } from '../application/ports/pasted-extraction.port';
import { USER_LINK_REPOSITORY } from '../application/ports/user-link-repository.port';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { GroupsFacadeMembership } from '../infrastructure/groups-facade-membership';
import { MongoGroupLinkRepository } from '../infrastructure/mongo-group-link.repository';
import { MongoJobLinkRepository } from '../infrastructure/mongo-job-link.repository';
import { MongoUserLinkRepository } from '../infrastructure/mongo-user-link.repository';
import { RunTaskPastedExtraction } from '../infrastructure/run-task-pasted-extraction';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeLinkDirectory } from '../infrastructure/users-facade-link-directory';

// Cableado de `LinksModule` dentro de la app (tarea 5.6 de job-links) y rutas protegidas: sin access token, las seis
// responden `401 unauthorized` antes de tocar nada.

const LINK_ID = '66e9a0000000000000000001';
const GROUP_ID = '66e9a0000000000000000002';

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

/** Clientes de Redis que `AiModule` tiene instanciados en una app ya construida. */
function aiRedisClientsOf(modules: ModulesContainer): Redis[] {
  return [...modules.values()]
    .filter((module) => module.metatype === AiModule)
    .flatMap((module) =>
      [...module.providers.values()].map(
        (wrapper): unknown => wrapper.instance,
      ),
    )
    .filter((instance): instance is Redis => instance instanceof Redis);
}

/** Configuración de IA con un proveedor real en la cadena: la que sí crea el cliente de la caché. Nadie la llama. */
function aiConfigWithRealCache(): AiConfig {
  const result = parseAiConfig(
    { NODE_ENV: 'test', AI_CHAIN: 'ollama', OLLAMA_URL: 'http://127.0.0.1:9' },
    { cwd: workspaceRoot() },
  );
  if (!result.ok) {
    throw new Error('aiConfigWithRealCache: invalid AI configuration');
  }
  return result.config;
}

describe('LinksModule', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(getMongoTestUri(), `links-di-${randomUUID()}`),
    });
    app = await createApp(config, apiTestAiConfig());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get<Connection>(getConnectionToken()).asPromise();
  });

  afterAll(async () => {
    await app.get<Connection>(getConnectionToken()).dropDatabase();
    await app.close();
  });

  it('resolves the six use cases of the module', () => {
    for (const useCase of [
      SaveLink,
      ImportLinks,
      ListGroupLinks,
      ListMyLinks,
      RemoveGroupLink,
      RemoveMyLink,
    ]) {
      expect(app.get(useCase, { strict: false })).toBeInstanceOf(useCase);
    }
  });

  it.each([
    [JOB_LINK_REPOSITORY, MongoJobLinkRepository],
    [GROUP_LINK_REPOSITORY, MongoGroupLinkRepository],
    [USER_LINK_REPOSITORY, MongoUserLinkRepository],
    [GROUP_MEMBERSHIP, GroupsFacadeMembership],
    [LINK_USER_DIRECTORY, UsersFacadeLinkDirectory],
    [LINKS_CLOCK, SystemClock],
  ])('binds a port to its Mongo or facade adapter', (token, adapter) => {
    expect(app.get(token, { strict: false })).toBeInstanceOf(adapter);
  });

  it('resolves runTask inside the links module, from the one AiModule the app builds', () => {
    // `PASTED_EXTRACTION` es un proveedor de `LinksModule` que inyecta `RUN_TASK`: si `AiModule` no le llegara, la app
    // no habría arrancado. Y hay un solo `runTask` en toda la app.
    expect(app.get(PASTED_EXTRACTION, { strict: false })).toBeInstanceOf(
      RunTaskPastedExtraction,
    );
    expect(typeof app.get(RUN_TASK, { strict: false })).toBe('function');
  });

  it('runs AI with the mock in replay, so the suite opens no new connection for it', async () => {
    // Con `mock` en la cadena, `AiModule` no crea el cliente de Redis de la caché y el ledger usa la conexión Mongoose
    // de la app: la suite de `api` sigue sin Redis (ADR-021 §4). Se mira en la app construida, no en la configuración.
    expect(apiTestAiConfig()).toMatchObject({
      chain: ['mock'],
      mock: { mode: 'replay' },
    });
    expect(aiRedisClientsOf(app.get(ModulesContainer))).toEqual([]);

    // Control: la misma búsqueda sí encuentra el cliente cuando la cadena lleva un proveedor real. Sin `init`, el
    // cliente perezoso no llega a conectar: nada toca la red.
    const control = await Test.createTestingModule({
      imports: [
        AppModule.register(
          await apiTestConfig({
            MONGO_URI: withDatabase(
              getMongoTestUri(),
              `links-di-control-${randomUUID()}`,
            ),
          }),
          aiConfigWithRealCache(),
        ),
      ],
    }).compile();
    try {
      const clients = aiRedisClientsOf(control.get(ModulesContainer));
      expect(clients).toHaveLength(1);
      expect(clients[0]?.status).toBe('wait');
    } finally {
      await control.close();
    }
  });

  it('resolves the outbox port from the outbox module, the one of the platform', () => {
    expect(app.get(OUTBOX, { strict: false })).toBeInstanceOf(MongoOutbox);
  });

  it.each([
    ['POST', '/api/links'],
    ['POST', '/api/links/import'],
    ['GET', '/api/links/mine'],
    ['DELETE', `/api/links/mine/${LINK_ID}`],
    ['GET', `/api/groups/${GROUP_ID}/links`],
    ['DELETE', `/api/groups/${GROUP_ID}/links/${LINK_ID}`],
  ])('answers 401 to %s %s without a token', async (method, url) => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      payload: method === 'POST' ? {} : undefined,
    });

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'unauthorized',
      message: 'Authentication required',
    });
  });
});
