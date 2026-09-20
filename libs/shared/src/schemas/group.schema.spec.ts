import { describe, expect, it } from 'vitest';
import {
  createGroupRequestSchema,
  GROUP_NAME_MAX_LENGTH,
  groupDetailSchema,
  groupMemberSchema,
  groupRoleSchema,
  groupSummarySchema,
  groupVisibilitySchema,
  INVITE_CODE_INPUT_MAX_LENGTH,
  inviteCodeResponseSchema,
  joinGroupRequestSchema,
  renameGroupRequestSchema,
  transferOwnershipRequestSchema,
  updateGroupSettingsRequestSchema,
} from './group.schema';

describe('groupNameSchema through the request bodies', () => {
  it('applies the same name rules when renaming', () => {
    expect(renameGroupRequestSchema.safeParse({ name: '  ' }).success).toBe(
      false,
    );
    expect(renameGroupRequestSchema.parse({ name: ' Backend LatAm ' })).toEqual(
      { name: 'Backend LatAm' },
    );
    expect(
      renameGroupRequestSchema.safeParse({
        name: 'a'.repeat(GROUP_NAME_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['', false],
    ['a', true],
    ['a'.repeat(GROUP_NAME_MAX_LENGTH), true],
    ['a'.repeat(GROUP_NAME_MAX_LENGTH + 1), false],
    ['   ', false],
    [`  ${'a'.repeat(GROUP_NAME_MAX_LENGTH)}  `, true],
  ])('name %j is valid: %s', (name, valid) => {
    expect(createGroupRequestSchema.safeParse({ name }).success).toBe(valid);
  });

  it('trims the outer spaces of the name', () => {
    expect(
      createGroupRequestSchema.parse({ name: '  Backend Bolivia ' }),
    ).toEqual({ name: 'Backend Bolivia' });
  });

  it('names the offending field', () => {
    const result = createGroupRequestSchema.safeParse({ name: '  ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      'name',
    ]);
  });

  it('exposes the name limit', () => {
    expect(GROUP_NAME_MAX_LENGTH).toBe(60);
  });
});

describe('joinGroupRequestSchema', () => {
  it('normalizes the code to upper case without outer spaces', () => {
    expect(joinGroupRequestSchema.parse({ code: '  a2b3c4d5 ' })).toEqual({
      code: 'A2B3C4D5',
    });
  });

  it.each([
    ['', false],
    ['   ', false],
    ['A', true],
    // El formato estricto (8 caracteres del alfabeto) lo juzga el dominio, no el contrato HTTP.
    ['ABC-12', true],
    ['a'.repeat(INVITE_CODE_INPUT_MAX_LENGTH), true],
    ['a'.repeat(INVITE_CODE_INPUT_MAX_LENGTH + 1), false],
  ])('code %j is valid: %s', (code, valid) => {
    expect(joinGroupRequestSchema.safeParse({ code }).success).toBe(valid);
  });

  it('exposes the sanity limit of the received code', () => {
    expect(INVITE_CODE_INPUT_MAX_LENGTH).toBe(64);
  });
});

describe('transferOwnershipRequestSchema', () => {
  it('carries the chosen member', () => {
    expect(
      transferOwnershipRequestSchema.parse({
        userId: '66e9a0000000000000000002',
      }),
    ).toEqual({ userId: '66e9a0000000000000000002' });
  });

  it.each([
    [{}, false],
    [{ userId: '' }, false],
    [{ userId: 42 }, false],
    // El formato del identificador lo juzga el caso de uso (`member_not_found`), no el contrato HTTP.
    [{ userId: 'not-an-id' }, true],
  ])('body %j is valid: %s', (body, valid) => {
    expect(transferOwnershipRequestSchema.safeParse(body).success).toBe(valid);
  });
});

describe('groupRoleSchema', () => {
  it('accepts owner and member only', () => {
    expect(groupRoleSchema.options).toEqual(['owner', 'member']);
  });
});

describe('groupSummarySchema', () => {
  const summary = {
    id: '66e9a0000000000000000001',
    name: 'Backend Bolivia',
    role: 'member',
    memberCount: 3,
    joinedAt: '2026-09-17T10:00:00.000Z',
  } as const;

  it('accepts exactly the summary fields', () => {
    expect(groupSummarySchema.parse(summary)).toEqual(summary);
  });

  it('rejects the invite code in a summary', () => {
    expect(
      groupSummarySchema.safeParse({ ...summary, inviteCode: 'A2B3C4D5' })
        .success,
    ).toBe(false);
  });
});

describe('groupVisibilitySchema y updateGroupSettingsRequestSchema', () => {
  it('admite exactamente los dos valores', () => {
    expect(groupVisibilitySchema.options).toEqual(['public', 'private']);
  });

  it('acepta el cuerpo del ajuste', () => {
    expect(
      updateGroupSettingsRequestSchema.parse({ defaultVisibility: 'private' }),
    ).toEqual({ defaultVisibility: 'private' });
  });

  it('rechaza un valor inválido nombrando defaultVisibility', () => {
    const result = updateGroupSettingsRequestSchema.safeParse({
      defaultVisibility: 'todos',
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      'defaultVisibility',
    ]);
  });

  it('exige el campo', () => {
    expect(updateGroupSettingsRequestSchema.safeParse({}).success).toBe(false);
  });

  it('no se cuela en el resumen de la lista de grupos', () => {
    expect(
      groupSummarySchema.safeParse({
        id: '66e9a0000000000000000001',
        name: 'Backend Bolivia',
        role: 'member',
        memberCount: 3,
        joinedAt: '2026-09-17T10:00:00.000Z',
        defaultVisibility: 'public',
      }).success,
    ).toBe(false);
  });
});

describe('groupDetailSchema', () => {
  const detail = {
    id: '66e9a0000000000000000001',
    name: 'Backend Bolivia',
    role: 'owner',
    memberCount: 1,
    createdAt: '2026-09-17T10:00:00.000Z',
    defaultVisibility: 'public',
  } as const;

  it('exige la visibilidad por defecto', () => {
    const { defaultVisibility: _omitted, ...withoutVisibility } = detail;

    expect(groupDetailSchema.safeParse(withoutVisibility).success).toBe(false);
    expect(
      groupDetailSchema.safeParse({ ...detail, defaultVisibility: 'todos' })
        .success,
    ).toBe(false);
  });

  it('accepts a detail with the invite code', () => {
    const withCode = { ...detail, inviteCode: 'A2B3C4D5' };

    expect(groupDetailSchema.parse(withCode)).toEqual(withCode);
  });

  it('accepts a detail without the invite code', () => {
    expect(groupDetailSchema.parse(detail)).toEqual(detail);
  });

  it('rejects an unknown field', () => {
    expect(
      groupDetailSchema.safeParse({ ...detail, ownerId: 'x' }).success,
    ).toBe(false);
  });
});

describe('inviteCodeResponseSchema', () => {
  it('carries only the invite code', () => {
    expect(inviteCodeResponseSchema.parse({ inviteCode: 'A2B3C4D5' })).toEqual({
      inviteCode: 'A2B3C4D5',
    });
    expect(
      inviteCodeResponseSchema.safeParse({
        inviteCode: 'A2B3C4D5',
        id: '66e9a0000000000000000001',
      }).success,
    ).toBe(false);
  });
});

describe('groupMemberSchema', () => {
  const member = {
    userId: '66e9a0000000000000000001',
    displayName: 'Ana',
    role: 'owner',
    joinedAt: '2026-09-17T10:00:00.000Z',
  } as const;

  it('accepts exactly the member fields', () => {
    expect(groupMemberSchema.parse(member)).toEqual(member);
  });

  it('rejects the email of a member', () => {
    expect(
      groupMemberSchema.safeParse({ ...member, email: 'ana@example.com' })
        .success,
    ).toBe(false);
  });
});
