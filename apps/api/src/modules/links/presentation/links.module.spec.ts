import { randomUUID } from 'node:crypto';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import { MongoOutbox } from '../../../infrastructure/outbox/mongo-outbox';
import { apiTestConfig } from '../../../test-support/test-config';
import { ImportLinks } from '../application/import-links.usecase';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { LINKS_CLOCK } from '../application/ports/clock.port';
import { GROUP_LINK_REPOSITORY } from '../application/ports/group-link-repository.port';
import { GROUP_MEMBERSHIP } from '../application/ports/group-membership.port';
import { JOB_LINK_REPOSITORY } from '../application/ports/job-link-repository.port';
import { LINK_USER_DIRECTORY } from '../application/ports/link-user-directory.port';
import { OUTBOX } from '../application/ports/outbox.port';
import { USER_LINK_REPOSITORY } from '../application/ports/user-link-repository.port';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { GroupsFacadeMembership } from '../infrastructure/groups-facade-membership';
import { MongoGroupLinkRepository } from '../infrastructure/mongo-group-link.repository';
import { MongoJobLinkRepository } from '../infrastructure/mongo-job-link.repository';
import { MongoUserLinkRepository } from '../infrastructure/mongo-user-link.repository';
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

describe('LinksModule', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(getMongoTestUri(), `links-di-${randomUUID()}`),
    });
    app = await createApp(config);
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
