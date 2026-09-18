import { describe, expect, it } from 'vitest';
import { isGroupId, isLinkId, isUserId } from './identifier';

describe('identifier format', () => {
  it.each([
    ['66e9a0000000000000000001', true],
    ['66E9A0000000000000000001', true],
    ['no-es-un-id', false],
    ['', false],
    // 12 caracteres: `isValidObjectId` los aceptaría, pero ningún id emitido por la API tiene esa forma.
    ['abcdefghijkl', false],
    ['66e9a000000000000000000', false],
    ['66e9a00000000000000000012', false],
    ['66e9a00000000000000000zz', false],
  ])('%j can identify a link: %s', (id, valid) => {
    expect(isLinkId(id)).toBe(valid);
  });

  it('uses the same format for links, groups and users', () => {
    const id = '66e9a0000000000000000001';

    expect([isLinkId(id), isGroupId(id), isUserId(id)]).toEqual([
      true,
      true,
      true,
    ]);
    expect([isLinkId('x'), isGroupId('x'), isUserId('x')]).toEqual([
      false,
      false,
      false,
    ]);
  });
});
