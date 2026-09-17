import { groupSummarySchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupFull, InvalidInviteCode, TooManyGroups } from '../domain/errors';
import type { Group } from '../domain/group';
import { MAX_GROUPS_PER_USER, MAX_MEMBERS_PER_GROUP } from '../domain/limits';
import { CreateGroup } from './create-group.usecase';
import { JoinByCode } from './join-by-code.usecase';
import { ListMyGroups } from './list-my-groups.usecase';
import {
  MovableClock,
  StubInviteCodeGenerator,
} from './testing/groups-test-doubles';
import { InMemoryGroupRepository } from './testing/in-memory-group.repository';

const ANA = '66e9a0000000000000000001';
const BETO = '66e9a0000000000000000002';

/** Identificador de usuario con el formato que exigen los dobles (hexadecimal de 24). */
function userId(index: number): string {
  return `66e9b${index.toString(16).padStart(19, '0')}`;
}

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let createGroup: CreateGroup;
let joinByCode: JoinByCode;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  createGroup = new CreateGroup(repository, clock);
  joinByCode = new JoinByCode(repository, clock);
});

/** Grupo de Ana tal y como está guardado, con su código de invitación. */
async function groupOfAna(name = 'Backend Bolivia'): Promise<Group> {
  const detail = await createGroup.execute(ANA, name);
  const group = await repository.findById(detail.id);
  if (group === null) {
    throw new Error('The group was just created');
  }
  return group;
}

describe('JoinByCode', () => {
  it('Unirse por código', async () => {
    const group = await groupOfAna();
    clock.advance(3_600_000);

    const summary = await joinByCode.execute(
      BETO,
      `  ${group.inviteCode.toLowerCase()} `,
    );

    expect(summary).toEqual({
      id: group.id,
      name: 'Backend Bolivia',
      role: 'member',
      memberCount: 2,
      joinedAt: '2026-09-17T11:00:00.000Z',
    });
    expect(groupSummarySchema.parse(summary)).toEqual(summary);
    expect(summary).not.toHaveProperty('inviteCode');
    await expect(
      new ListMyGroups(repository).execute(BETO),
    ).resolves.toHaveLength(1);
  });

  it('Código desconocido', async () => {
    await groupOfAna();

    await expect(joinByCode.execute(BETO, 'A2B3C4D5')).rejects.toBeInstanceOf(
      InvalidInviteCode,
    );
  });

  it('Código con formato inválido', async () => {
    const findByInviteCode = vi.spyOn(repository, 'findByInviteCode');

    const unknown = await joinByCode
      .execute(BETO, 'A2B3C4D5')
      .catch((e: unknown) => e);
    const malformed = await joinByCode
      .execute(BETO, 'ABC-12')
      .catch((e: unknown) => e);

    expect(malformed).toBeInstanceOf(InvalidInviteCode);
    // Mismo error y mismo mensaje que un código desconocido: no se distinguen.
    expect((malformed as InvalidInviteCode).message).toBe(
      (unknown as InvalidInviteCode).message,
    );
    // El formato lo resuelve el dominio: un código mal formado no llega al repositorio.
    expect(findByInviteCode).toHaveBeenCalledTimes(1);
    findByInviteCode.mockRestore();
  });

  it('Unirse dos veces', async () => {
    const group = await groupOfAna();
    const first = await joinByCode.execute(BETO, group.inviteCode);
    clock.advance(3_600_000);

    const again = await joinByCode.execute(BETO, group.inviteCode);

    expect(again).toEqual(first);
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
  });

  it('El owner se une a su propio grupo', async () => {
    const group = await groupOfAna();

    const summary = await joinByCode.execute(ANA, group.inviteCode);

    expect(summary.role).toBe('owner');
    expect(summary.memberCount).toBe(1);
    expect(summary).not.toHaveProperty('inviteCode');
  });

  it('Grupo completo', async () => {
    const group = await groupOfAna();
    for (let index = 1; index < MAX_MEMBERS_PER_GROUP; index += 1) {
      await joinByCode.execute(userId(index), group.inviteCode);
    }

    await expect(
      joinByCode.execute(BETO, group.inviteCode),
    ).rejects.toBeInstanceOf(GroupFull);

    await expect(repository.listMembers(group.id)).resolves.toHaveLength(
      MAX_MEMBERS_PER_GROUP,
    );
  });

  it('Límite alcanzado al unirse', async () => {
    for (let index = 0; index < MAX_GROUPS_PER_USER; index += 1) {
      await createGroup.execute(BETO, `Grupo ${index}`);
    }
    const group = await groupOfAna();

    await expect(
      joinByCode.execute(BETO, group.inviteCode),
    ).rejects.toBeInstanceOf(TooManyGroups);

    await expect(repository.findMembership(group.id, BETO)).resolves.toBeNull();
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(1);
  });

  it('En el límite, volver a un grupo propio', async () => {
    const own = await groupOfAna('Propio de Beto');
    await joinByCode.execute(BETO, own.inviteCode);
    for (let index = 0; index < MAX_GROUPS_PER_USER - 1; index += 1) {
      await createGroup.execute(BETO, `Grupo ${index}`);
    }

    const summary = await joinByCode.execute(BETO, own.inviteCode);

    expect(summary).toMatchObject({ id: own.id, role: 'member' });
    await expect(repository.countGroupsOfUser(BETO)).resolves.toBe(
      MAX_GROUPS_PER_USER,
    );
  });
});
