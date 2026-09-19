import { describe, expect, it } from 'vitest';
import {
  COMMENT_TEXT_MAX_LENGTH,
  commentTextLength,
  normalizeCommentText,
  SHARE_NOTE_MAX_LENGTH,
} from './comment-text';

// Normalización del texto de comentarios y notas (D5 de group-comments): se quita lo invisible y nada más.

describe('normalizeCommentText', () => {
  it.each([
    ['keeps a phone number', 'Escríbele a Juan al +591 70000000', 'Escríbele a Juan al +591 70000000'],
    ['keeps an email', 'rrhh@empresa.example', 'rrhh@empresa.example'],
    ['keeps what looks like HTML', '<b>ojo</b> <script>alert(1)</script>', '<b>ojo</b> <script>alert(1)</script>'],
    ['trims outer spaces and line breaks', '  \n Piden C1 \n ', 'Piden C1'],
    ['turns CRLF and CR into LF', 'uno\r\ndos\rtres', 'uno\ndos\ntres'],
    ['keeps inner line breaks', 'uno\n\ndos', 'uno\n\ndos'],
    ['drops the null character', 'a\u0000b', 'ab'],
    ['drops other C0 controls, tab included', 'a\u0007b\tc', 'abc'],
    ['drops DEL and C1 controls', 'a\u007Fb\u0085c\u009Fd', 'abcd'],
    ['drops the right-to-left override', 'a\u202Eb', 'ab'],
    ['drops every direction formatting character', '\u202A\u202B\u202C\u202D\u202Ex\u2066\u2067\u2068\u2069', 'x'],
    ['keeps emoji and accents', 'Ya cerró 😢', 'Ya cerró 😢'],
    ['leaves only spaces empty', '   \r\n  ', ''],
  ])('%s', (_case, input, expected) => {
    expect(normalizeCommentText(input)).toBe(expected);
  });

  it('is idempotent', () => {
    const inputs = [' a\r\n\u0000b\u202E ', '\u202E  x  ', 'plain'];
    for (const input of inputs) {
      const once = normalizeCommentText(input);
      expect(normalizeCommentText(once)).toBe(once);
    }
  });
});

describe('limits', () => {
  it('allows 500 code points in a comment and 280 in a note', () => {
    expect(COMMENT_TEXT_MAX_LENGTH).toBe(500);
    expect(SHARE_NOTE_MAX_LENGTH).toBe(280);
  });

  it('measures in code points, not UTF-16 units', () => {
    expect(commentTextLength('😢😢')).toBe(2);
  });
});
