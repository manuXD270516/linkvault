import { groupSummarySchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GroupFull,
  InvalidInviteCode,
  TooManyGroups,
  TooManyJoinAttempts,
} from '../domain/errors';
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
import { InMemoryJoinAttemptLimiter } from './testing/in-memory-join-attempt-limiter';

const ANA = '66e9a0000000000000000001';
const IP = '203.0.113.7';
const BETO = '66e9a0000000000000000002';

/** Identificador de usuario con el formato que exigen los dobles (hexadecimal de 24). */
function userId(index: number): string {
  return `66e9b${index.toString(16).padStart(19, '0')}`;
}

let clock: MovableClock;
let repository: InMemoryGroupRepository;
let createGroup: CreateGroup;
let limiter: InMemoryJoinAttemptLimiter;
let joinByCode: JoinByCode;

beforeEach(() => {
  clock = new MovableClock(new Date('2026-09-17T10:00:00.000Z'));
  repository = new InMemoryGroupRepository(new StubInviteCodeGenerator());
  createGroup = new CreateGroup(repository, clock);
  limiter = new InMemoryJoinAttemptLimiter();
  joinByCode = new JoinByCode(repository, clock, limiter);
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
      IP,
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

    await expect(
      joinByCode.execute(BETO, 'A2B3C4D5', IP),
    ).rejects.toBeInstanceOf(InvalidInviteCode);
  });

  it('Código con formato inválido', async () => {
    const findByInviteCode = vi.spyOn(repository, 'findByInviteCode');

    const unknown = await joinByCode
      .execute(BETO, 'A2B3C4D5', IP)
      .catch((e: unknown) => e);
    const malformed = await joinByCode
      .execute(BETO, 'ABC-12', IP)
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
    const first = await joinByCode.execute(BETO, group.inviteCode, IP);
    clock.advance(3_600_000);

    const again = await joinByCode.execute(BETO, group.inviteCode, IP);

    expect(again).toEqual(first);
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(2);
  });

  it('El owner se une a su propio grupo', async () => {
    const group = await groupOfAna();

    const summary = await joinByCode.execute(ANA, group.inviteCode, IP);

    expect(summary.role).toBe('owner');
    expect(summary.memberCount).toBe(1);
    expect(summary).not.toHaveProperty('inviteCode');
  });

  it('Grupo completo', async () => {
    const group = await groupOfAna();
    for (let index = 1; index < MAX_MEMBERS_PER_GROUP; index += 1) {
      await joinByCode.execute(userId(index), group.inviteCode, IP);
    }

    await expect(
      joinByCode.execute(BETO, group.inviteCode, IP),
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
      joinByCode.execute(BETO, group.inviteCode, IP),
    ).rejects.toBeInstanceOf(TooManyGroups);

    await expect(repository.findMembership(group.id, BETO)).resolves.toBeNull();
    await expect(repository.listMembers(group.id)).resolves.toHaveLength(1);
  });

  it('En el límite, volver a un grupo propio', async () => {
    const own = await groupOfAna('Propio de Beto');
    await joinByCode.execute(BETO, own.inviteCode, IP);
    for (let index = 0; index < MAX_GROUPS_PER_USER - 1; index += 1) {
      await createGroup.execute(BETO, `Grupo ${index}`);
    }

    const summary = await joinByCode.execute(BETO, own.inviteCode, IP);

    expect(summary).toMatchObject({ id: own.id, role: 'member' });
    await expect(repository.countGroupsOfUser(BETO)).resolves.toBe(
      MAX_GROUPS_PER_USER,
    );
  });
});

describe('JoinByCode attempt limit', () => {
  it('rejects with the Retry-After of the limiter before resolving the code', async () => {
    const group = await groupOfAna();
    const limited = new InMemoryJoinAttemptLimiter({
      userLimit: 0,
      retryAfterSeconds: 480,
    });
    const findByInviteCode = vi.spyOn(repository, 'findByInviteCode');

    const error = await new JoinByCode(repository, clock, limited)
      .execute(BETO, group.inviteCode, IP)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(TooManyJoinAttempts);
    expect((error as TooManyJoinAttempts).retryAfterSeconds).toBe(480);
    expect(findByInviteCode).not.toHaveBeenCalled();
    await expect(repository.findMembership(group.id, BETO)).resolves.toBeNull();
  });

  it.each([
    ['an unknown code', 'A2B3C4D5'],
    ['a malformed code', 'ABC-12'],
  ])('keeps the attempt of %s', async (_case, code) => {
    await groupOfAna();

    await expect(joinByCode.execute(BETO, code, IP)).rejects.toBeInstanceOf(
      InvalidInviteCode,
    );

    expect(limiter.givenBack).toEqual([]);
    expect(limiter.attemptsOfUser(BETO)).toBe(1);
    expect(limiter.attemptsOfIp(IP)).toBe(1);
  });

  it('gives the attempt back once when joining', async () => {
    const group = await groupOfAna();

    await joinByCode.execute(BETO, group.inviteCode, IP);

    expect(limiter.givenBack).toHaveLength(1);
    expect(limiter.attemptsOfUser(BETO)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(0);
  });

  it('gives the attempt back once to someone who was already a member', async () => {
    const group = await groupOfAna();

    await joinByCode.execute(ANA, group.inviteCode, IP);

    expect(limiter.givenBack).toHaveLength(1);
    expect(limiter.attemptsOfUser(ANA)).toBe(0);
  });

  it('gives the attempt back once when the group is full', async () => {
    const group = await groupOfAna();
    for (let index = 1; index < MAX_MEMBERS_PER_GROUP; index += 1) {
      await joinByCode.execute(userId(index), group.inviteCode, IP);
    }
    limiter.givenBack.length = 0;

    await expect(
      joinByCode.execute(BETO, group.inviteCode, IP),
    ).rejects.toBeInstanceOf(GroupFull);

    expect(limiter.givenBack).toHaveLength(1);
    expect(limiter.attemptsOfUser(BETO)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(0);
  });

  it('gives the attempt back once when the user is in too many groups', async () => {
    for (let index = 0; index < MAX_GROUPS_PER_USER; index += 1) {
      await createGroup.execute(BETO, `Grupo ${index}`);
    }
    const group = await groupOfAna();

    await expect(
      joinByCode.execute(BETO, group.inviteCode, IP),
    ).rejects.toBeInstanceOf(TooManyGroups);

    expect(limiter.givenBack).toHaveLength(1);
    expect(limiter.attemptsOfUser(BETO)).toBe(0);
  });

  it('gives the attempt back once when the repository fails unexpectedly', async () => {
    const group = await groupOfAna();
    const failure = new Error('connection lost');
    vi.spyOn(repository, 'addMember').mockRejectedValueOnce(failure);

    await expect(joinByCode.execute(BETO, group.inviteCode, IP)).rejects.toBe(
      failure,
    );

    expect(limiter.givenBack).toHaveLength(1);
    expect(limiter.attemptsOfUser(BETO)).toBe(0);
    expect(limiter.attemptsOfIp(IP)).toBe(0);
  });

  it('does not reset the count with a valid code', async () => {
    const group = await groupOfAna();
    await joinByCode.execute(BETO, 'A2B3C4D5', IP).catch(() => undefined);
    await joinByCode.execute(BETO, 'A2B3C4D6', IP).catch(() => undefined);

    await joinByCode.execute(BETO, group.inviteCode, IP);

    // Los dos códigos incorrectos siguen contando: el acierto solo devuelve su propio intento.
    expect(limiter.attemptsOfUser(BETO)).toBe(2);
  });
});
