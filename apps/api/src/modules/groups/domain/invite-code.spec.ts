import { describe, expect, it } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  isValidInviteCode,
  normalizeInviteCode,
} from './invite-code';

describe('INVITE_CODE_ALPHABET', () => {
  it('has the 30 symbols of Crockford base32 without ambiguous pairs', () => {
    expect(INVITE_CODE_ALPHABET).toHaveLength(30);
    expect(new Set(INVITE_CODE_ALPHABET).size).toBe(30);
    expect(INVITE_CODE_LENGTH).toBe(8);
  });

  it.each([...'01ILOU'])('excludes the ambiguous symbol %s', (symbol) => {
    expect(INVITE_CODE_ALPHABET).not.toContain(symbol);
  });
});

describe('normalizeInviteCode', () => {
  it('removes the outer spaces and upper cases the code', () => {
    expect(normalizeInviteCode('  a2b3c4d5 ')).toBe('A2B3C4D5');
  });

  it('leaves an already normalized code untouched', () => {
    expect(normalizeInviteCode('A2B3C4D5')).toBe('A2B3C4D5');
  });
});

describe('isValidInviteCode', () => {
  it('accepts a code of 8 symbols of the alphabet', () => {
    expect(isValidInviteCode('A2B3C4D5')).toBe(true);
    expect(isValidInviteCode(INVITE_CODE_ALPHABET.slice(0, 8))).toBe(true);
  });

  it.each([
    ['A2B3C4D', '7 characters'],
    ['A2B3C4D56', '9 characters'],
    ['', 'empty'],
  ])('rejects %j (%s)', (code) => {
    expect(isValidInviteCode(code)).toBe(false);
  });

  it.each([...'01ILOU'])(
    'rejects a code with the ambiguous symbol %s',
    (symbol) => {
      expect(isValidInviteCode(`${symbol}2B3C4D5`)).toBe(false);
    },
  );

  it.each(['ABC-1234', 'A2B3 C4D', 'A2B3C4D ', 'Ñ2B3C4D5'])(
    'rejects %j: it has symbols outside the alphabet',
    (code) => {
      expect(isValidInviteCode(code)).toBe(false);
    },
  );

  it('rejects a lower case code and accepts it once normalized', () => {
    expect(isValidInviteCode('a2b3c4d5')).toBe(false);
    expect(isValidInviteCode(normalizeInviteCode('a2b3c4d5'))).toBe(true);
  });

  it('rejects a code with outer spaces and accepts it once normalized', () => {
    expect(isValidInviteCode('  A2B3C4D5 ')).toBe(false);
    expect(isValidInviteCode(normalizeInviteCode('  A2B3C4D5 '))).toBe(true);
  });

  it('rejects a code with inner spaces even once normalized', () => {
    expect(isValidInviteCode(normalizeInviteCode(' A2B3 C4D5 '))).toBe(false);
  });
});
