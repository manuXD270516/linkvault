import { groupDetailSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound, OwnerRoleRequired } from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { GetGroup } from './get-group.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';
import { UpdateGroupSettings } from './update-group-settings.usecase';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const UNKNOWN_GROUP = '66e9a00000000000000000ff';
const MALFORMED = 'no-es-un-id';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let updateSettings: UpdateGroupSettings;
let getGroup: GetGroup;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  updateSettings = new UpdateGroupSettings(repository, clock);
  getGroup = new GetGroup(repository);
});

async function groupOfAnaWithBeto() {
  const group = await new CreateGroup(repository, clock).execute(ANA, 'Grupo');
  await repository.addMember({
    groupId: group.id,
    userId: BETO,
    now: clock.now(),
  });
  return group;
}

describe('UpdateGroupSettings', () => {
  it('El owner apaga la visibilidad por defecto', async () => {
    const group = await groupOfAnaWithBeto();

    const detail = await updateSettings.execute(ANA, group.id, 'private');

    expect(detail.defaultVisibility).toBe('private');
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
    await expect(getGroup.execute(BETO, group.id)).resolves.toMatchObject({
      defaultVisibility: 'private',
    });
  });

  it('Un miembro no cambia el ajuste', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(
      updateSettings.execute(BETO, group.id, 'private'),
    ).rejects.toBeInstanceOf(OwnerRoleRequired);
    await expect(getGroup.execute(BETO, group.id)).resolves.toMatchObject({
      defaultVisibility: 'public',
    });
  });

  it.each([
    ['un grupo ajeno', (groupId: string) => groupId],
    ['uno inexistente', () => UNKNOWN_GROUP],
    ['un identificador mal formado', () => MALFORMED],
  ])('Quien no es miembro recibe group_not_found con %s', async (_case, of) => {
    const group = await groupOfAnaWithBeto();

    await expect(
      updateSettings.execute(CARLA, of(group.id), 'private'),
    ).rejects.toBeInstanceOf(GroupNotFound);
  });

  it('Grupo nuevo', async () => {
    const group = await groupOfAnaWithBeto();

    await expect(getGroup.execute(ANA, group.id)).resolves.toMatchObject({
      defaultVisibility: 'public',
    });
  });

  it('vuelve a encenderlo y deja el ajuste como estaba', async () => {
    const group = await groupOfAnaWithBeto();

    await updateSettings.execute(ANA, group.id, 'private');
    const detail = await updateSettings.execute(ANA, group.id, 'public');

    expect(detail.defaultVisibility).toBe('public');
  });

  it('no toca el nombre ni el código de invitación', async () => {
    const group = await groupOfAnaWithBeto();

    const detail = await updateSettings.execute(ANA, group.id, 'private');

    expect(detail.name).toBe(group.name);
    expect(detail.inviteCode).toBe(group.inviteCode);
    expect(detail.memberCount).toBe(2);
  });
});
