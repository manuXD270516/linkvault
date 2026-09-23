import { describe, expect, it } from 'vitest';
import { resolveSessionClient } from './session-client';

describe('resolveSessionClient', () => {
  it.each([
    [undefined, 'web'],
    [null, 'web'],
    ['web', 'web'],
    ['extension', 'extension'],
  ] as const)('maps %j → %j', (input, expected) => {
    expect(resolveSessionClient(input)).toBe(expected);
  });
});
