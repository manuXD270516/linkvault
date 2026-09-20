import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import { Inject, Injectable, Module } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfigModule } from '../../../infrastructure/config/app-config.module';
import { apiTestConfig } from '../../../test-support/test-config';
import { UsersFacade } from '../../users/application/users.facade';
import { CreateGroup } from '../application/create-group.usecase';
import { GroupsFacade } from '../application/groups.facade';
import { ListMembers } from '../application/list-members.usecase';
import { GROUP_MEMBER_DIRECTORY } from '../application/ports/group-member-directory.port';
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MODEL_NAME,
} from '../infrastructure/group.schemas';
import { UsersFacadeMemberDirectory } from '../infrastructure/users-facade-member-directory';
import { GroupsModule } from './groups.module';

// Cableado de `GroupsModule` con la conexión Mongoose por defecto, contra el MongoMemoryReplSet del preset. El facade es
// la única entrada del módulo, así que la prueba de DI lo inyecta desde otro módulo, como hará `job-links`.

/** Otro módulo del monolito: solo importa `GroupsModule` y solo puede inyectar `GroupsFacade`. */
@Injectable()
class SomeOtherModuleService {
  constructor(@Inject(GroupsFacade) readonly groups: GroupsFacade) {}
}

@Module({ imports: [GroupsModule], providers: [SomeOtherModuleService] })
class OtherModule {}

describe('GroupsModule', () => {
  let moduleRef: TestingModule;
  let connection: Connection;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        // `LimitsModule` (límite del join) lee la URL de Redis de la configuración; nadie se une en estos tests.
        AppConfigModule.forRoot(await apiTestConfig()),
        MongooseModule.forRoot(getMongoTestUri(), {
          dbName: `groups-module-${randomUUID()}`,
        }),
        OtherModule,
      ],
    }).compile();
    connection = moduleRef.get<Connection>(getConnectionToken());
    await connection.model(GROUP_MODEL_NAME).init();
    await connection.model(GROUP_MEMBER_MODEL_NAME).init();
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await moduleRef.close();
  });

  it('resolves the facade from another module and answers over Mongo', async () => {
    const ana = await moduleRef
      .get(UsersFacade, { strict: false })
      .createWithPassword({
        email: `${randomUUID()}@example.com`,
        passwordHash: '$argon2id$hash',
        displayName: 'Ana',
      });
    const group = await moduleRef
      .get(CreateGroup, { strict: false })
      .execute(ana.id, 'Cableado');

    const { groups } = moduleRef.get(SomeOtherModuleService);

    await expect(groups.isMember(group.id, ana.id)).resolves.toBe(true);
    await expect(groups.getGroupsOf(ana.id)).resolves.toEqual([
      {
        groupId: group.id,
        name: 'Cableado',
        role: 'owner',
        defaultVisibility: 'public',
      },
    ]);
    await expect(groups.membershipOf(group.id, ana.id)).resolves.toBe('owner');
  });

  it('wires the member directory over UsersFacade, so the names come from users', async () => {
    const directory = moduleRef.get(GROUP_MEMBER_DIRECTORY, { strict: false });
    const beto = await moduleRef
      .get(UsersFacade, { strict: false })
      .createWithPassword({
        email: `${randomUUID()}@example.com`,
        passwordHash: '$argon2id$hash',
        displayName: 'Beto',
      });
    const group = await moduleRef
      .get(CreateGroup, { strict: false })
      .execute(beto.id, 'Con nombres');

    const members = await moduleRef
      .get(ListMembers, { strict: false })
      .execute(beto.id, group.id);

    expect(directory).toBeInstanceOf(UsersFacadeMemberDirectory);
    expect(members).toEqual([
      {
        userId: beto.id,
        displayName: 'Beto',
        role: 'owner',
        joinedAt: expect.any(String),
      },
    ]);
  });
});
