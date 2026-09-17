import { Inject, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { CreateGroup } from './create-group.usecase';
import { GroupsFacade } from './groups.facade';
import { GROUPS_CLOCK } from './ports/clock.port';
import { GROUP_REPOSITORY } from './ports/group-repository.port';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const ORPHAN_GROUP = '66e9a00000000000000000ff';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let facade: GroupsFacade;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  facade = new GroupsFacade(repository);
});

describe('GroupsFacade', () => {
  it('Otro módulo comprueba pertenencia', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    const other = await createGroup.execute(BETO, 'De Beto');

    await expect(facade.isMember(own.id, ANA)).resolves.toBe(true);
    await expect(facade.isMember(other.id, ANA)).resolves.toBe(false);
  });

  it('answers false for an unknown group, a malformed id and an orphan group', async () => {
    await expect(facade.isMember(ORPHAN_GROUP, ANA)).resolves.toBe(false);
    await expect(facade.isMember('no-es-un-id', ANA)).resolves.toBe(false);
    await expect(facade.isMember(ORPHAN_GROUP, 'no-es-un-id')).resolves.toBe(
      false,
    );
  });

  it('lists the groups of a user with their role, newest first', async () => {
    const createGroup = new CreateGroup(repository, clock);
    const own = await createGroup.execute(ANA, 'De Ana');
    const other = await createGroup.execute(BETO, 'De Beto');
    clock.advance(3_600_000);
    await repository.addMember({
      groupId: other.id,
      userId: ANA,
      now: clock.now(),
    });

    await expect(facade.getGroupsOf(ANA)).resolves.toEqual([
      { groupId: other.id, role: 'member' },
      { groupId: own.id, role: 'owner' },
    ]);
  });

  it('leaves orphan memberships out of the list', async () => {
    const own = await new CreateGroup(repository, clock).execute(ANA, 'Vivo');
    await repository.addMember({
      groupId: ORPHAN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    await expect(facade.getGroupsOf(ANA)).resolves.toEqual([
      { groupId: own.id, role: 'owner' },
    ]);
  });

  it('answers an empty list for a user without groups and for a malformed id', async () => {
    await expect(facade.getGroupsOf(BETO)).resolves.toEqual([]);
    await expect(facade.getGroupsOf('no-es-un-id')).resolves.toEqual([]);
  });
});

// Cableado: el facade es la única entrada, así que otro módulo tiene que poder inyectarlo importando el módulo que lo
// exporta. `GroupsModule` llega con la tarea 5.1; aquí se comprueba el contrato de DI con los dobles en memoria.

@Module({
  providers: [
    {
      provide: GROUP_REPOSITORY,
      useFactory: () =>
        new InMemoryGroupRepository(new StubInviteCodeGenerator()),
    },
    { provide: GROUPS_CLOCK, useClass: MovableClock },
    GroupsFacade,
  ],
  exports: [GroupsFacade],
})
class GroupsModuleDouble {}

/** Otro módulo del monolito, que solo conoce el facade. */
@Injectable()
class SomeOtherModuleService {
  constructor(@Inject(GroupsFacade) private readonly groups: GroupsFacade) {}

  canSee(groupId: string, userId: string): Promise<boolean> {
    return this.groups.isMember(groupId, userId);
  }
}

@Module({
  imports: [GroupsModuleDouble],
  providers: [SomeOtherModuleService],
})
class OtherModule {}

describe('GroupsFacade wiring', () => {
  it('is injectable from another module', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OtherModule],
    }).compile();

    const service = moduleRef.get(SomeOtherModuleService);
    const repositoryFromDi = moduleRef.get<InMemoryGroupRepository>(
      GROUP_REPOSITORY,
      { strict: false },
    );
    const group = await repositoryFromDi.create({
      name: 'Desde DI',
      ownerId: ANA,
      now: new Date('2026-09-17T10:00:00.000Z'),
    });

    await expect(service.canSee(group.id, ANA)).resolves.toBe(true);
    await expect(service.canSee(group.id, BETO)).resolves.toBe(false);
    await moduleRef.close();
  });
});
