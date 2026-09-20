import { groupDetailSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GroupNotFound } from '../domain/errors';
import { CreateGroup } from './create-group.usecase';
import { GetGroup } from './get-group.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';
const CARLA = '66e9a0000000000000000003';
const UNKNOWN_GROUP = '66e9a00000000000000000ff';
const MALFORMED = 'no-es-un-id';

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let getGroup: GetGroup;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
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

describe('GetGroup', () => {
  it('Detalle para el owner', async () => {
    const group = await groupOfAnaWithBeto();

    const detail = await getGroup.execute(ANA, group.id);

    expect(detail).toEqual({
      id: group.id,
      name: 'Grupo',
      role: 'owner',
      memberCount: 2,
      createdAt: '2026-09-17T10:00:00.000Z',
      inviteCode: group.inviteCode,
      defaultVisibility: 'public',
    });
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
  });

  it('Detalle para un miembro', async () => {
    const group = await groupOfAnaWithBeto();

    const detail = await getGroup.execute(BETO, group.id);

    expect(detail).toEqual({
      id: group.id,
      name: 'Grupo',
      role: 'member',
      memberCount: 2,
      createdAt: '2026-09-17T10:00:00.000Z',
      defaultVisibility: 'public',
    });
    expect(detail).not.toHaveProperty('inviteCode');
  });

  it('Grupo anterior al ajuste', async () => {
    const group = await groupOfAnaWithBeto();

    // Un grupo guardado antes del ajuste no tiene `settings`, y el repositorio lo lee como `public` (D3): la respuesta
    // nunca se queda sin el campo y ninguno de sus links ya compartidos se publica por ello.
    await expect(getGroup.execute(BETO, group.id)).resolves.toMatchObject({
      defaultVisibility: 'public',
    });
  });

  it('Grupo ajeno indistinguible de uno inexistente', async () => {
    const group = await groupOfAnaWithBeto();

    const errors = await Promise.all(
      [group.id, UNKNOWN_GROUP, MALFORMED].map((groupId) =>
        getGroup.execute(CARLA, groupId).then(
          () => null,
          (error: unknown) => error,
        ),
      ),
    );

    for (const error of errors) {
      expect(error).toBeInstanceOf(GroupNotFound);
    }
    const [ajeno, inexistente, malFormado] = errors as GroupNotFound[];
    expect(ajeno?.code).toBe(inexistente?.code);
    expect(ajeno?.message).toBe(inexistente?.message);
    expect(ajeno?.message).toBe(malFormado?.message);
  });

  it('answers GroupNotFound for an orphan membership', async () => {
    await repository.addMember({
      groupId: UNKNOWN_GROUP,
      userId: ANA,
      now: clock.now(),
    });

    await expect(getGroup.execute(ANA, UNKNOWN_GROUP)).rejects.toBeInstanceOf(
      GroupNotFound,
    );
  });
});
