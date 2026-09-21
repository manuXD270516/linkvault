import { randomUUID } from 'node:crypto';
import { RUN_TASK } from '@linkvault/ai';
import { apiErrorResponseSchema } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { ModulesContainer } from '@nestjs/core';
import { getConnectionToken } from '@nestjs/mongoose';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../../app/create-app';
import {
  apiTestAiConfig,
  apiTestConfig,
} from '../../../test-support/test-config';
import { LinksModule } from '../../links/presentation/links.module';
import { ChangeApplicationStatus } from '../application/change-application-status.usecase';
import { ApplicationFitScores } from '../application/application-fit-scores';
import { GetApplicationTimeline } from '../application/get-application-timeline.usecase';
import { ListGroupTrackers } from '../application/list-group-trackers.usecase';
import { ListMyApplications } from '../application/list-my-applications.usecase';
import { APPLICATION_GROUPS } from '../application/ports/application-groups.port';
import { APPLICATION_LINKS } from '../application/ports/application-links.port';
import { APPLICATION_REPOSITORY } from '../application/ports/application-repository.port';
import { APPLICATION_USER_DIRECTORY } from '../application/ports/application-user-directory.port';
import { APPLICATIONS_CLOCK } from '../application/ports/clock.port';
import { TrackLink } from '../application/track-link.usecase';
import { UntrackApplication } from '../application/untrack-application.usecase';
import { UpdateApplication } from '../application/update-application.usecase';
import { GroupsFacadeApplicationGroups } from '../infrastructure/groups-facade-application-groups';
import { LinksFacadeApplicationLinks } from '../infrastructure/links-facade-application-links';
import { MongoApplicationRepository } from '../infrastructure/mongo-application.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeApplicationDirectory } from '../infrastructure/users-facade-application-directory';

// Cableado de `ApplicationsModule` dentro de la app (tarea 5.1 de applications-tracking) y rutas protegidas.

const ID = '66e9a0000000000000000001';

function withDatabase(uri: string, database: string): string {
  const url = new URL(uri);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('ApplicationsModule', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const config = await apiTestConfig({
      MONGO_URI: withDatabase(
        getMongoTestUri(),
        `applications-di-${randomUUID()}`,
      ),
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

  it('resolves the seven use cases of the module', () => {
    for (const useCase of [
      TrackLink,
      ListMyApplications,
      ChangeApplicationStatus,
      UpdateApplication,
      GetApplicationTimeline,
      UntrackApplication,
      ListGroupTrackers,
    ]) {
      expect(app.get(useCase, { strict: false })).toBeInstanceOf(useCase);
    }
  });

  it('exports ApplicationFitScores for match to register on init', () => {
    expect(app.get(ApplicationFitScores, { strict: false })).toBeInstanceOf(
      ApplicationFitScores,
    );
  });

  it.each([
    [APPLICATION_REPOSITORY, MongoApplicationRepository],
    [APPLICATION_LINKS, LinksFacadeApplicationLinks],
    [APPLICATION_GROUPS, GroupsFacadeApplicationGroups],
    [APPLICATION_USER_DIRECTORY, UsersFacadeApplicationDirectory],
    [APPLICATIONS_CLOCK, SystemClock],
  ])('binds a port to its Mongo or facade adapter', (token, adapter) => {
    expect(app.get(token, { strict: false })).toBeInstanceOf(adapter);
  });

  it('shares the one LinksModule that the app builds with the AI, instead of a second one', () => {
    const linksModules = [...app.get(ModulesContainer).values()].filter(
      (module) => module.metatype === LinksModule,
    );

    expect(linksModules).toHaveLength(1);
    expect(typeof app.get(RUN_TASK, { strict: false })).toBe('function');
  });

  it.each([
    ['POST', '/api/applications'],
    ['GET', '/api/applications'],
    ['PATCH', `/api/applications/${ID}/status`],
    ['PATCH', `/api/applications/${ID}`],
    ['GET', `/api/applications/${ID}/events`],
    ['DELETE', `/api/applications/${ID}`],
    ['GET', `/api/groups/${ID}/applications?linkIds=${ID}`],
  ])('answers 401 to %s %s without a token', async (method, url) => {
    const response = await app.inject({
      method: method as 'GET',
      url,
      payload: method === 'POST' || method === 'PATCH' ? {} : undefined,
    });

    expect(response.statusCode).toBe(401);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'unauthorized',
      message: 'Authentication required',
    });
  });
});
