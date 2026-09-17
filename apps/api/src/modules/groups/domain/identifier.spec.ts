import { describe, expect, it } from 'vitest';
import { isGroupId, isUserId } from './identifier';

const VALID = '66e9a0000000000000000001';

describe.each([
  ['isGroupId', isGroupId],
  ['isUserId', isUserId],
] as const)('%s', (_name, isValidId) => {
  it('accepts a 24 character hexadecimal id, in any case', () => {
    expect(isValidId(VALID)).toBe(true);
    expect(isValidId(VALID.toUpperCase())).toBe(true);
  });

  it.each([
    ['no-es-un-id', 'not hexadecimal'],
    ['', 'empty'],
    ['66e9a000000000000000000', '23 characters'],
    ['66e9a00000000000000000012', '25 characters'],
    [' 66e9a0000000000000000001', 'a leading space'],
    ['66e9a0000000000000000001 ', 'a trailing space'],
    ['zzzzzzzzzzzzzzzzzzzzzzzz', 'letters outside hexadecimal'],
    ['aaaaaaaaaaaa', '12 byte string accepted by isValidObjectId'],
  ])('rejects %j (%s)', (id) => {
    expect(isValidId(id)).toBe(false);
  });
});
