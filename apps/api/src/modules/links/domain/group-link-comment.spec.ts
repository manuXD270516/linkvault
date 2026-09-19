import { describe, expect, it } from 'vitest';
import { InvalidCommentText, InvalidShareNote } from './errors';
import {
  authorLeftGiven,
  createGroupLinkComment,
  mayDeleteComment,
} from './group-link-comment';
import { createShareNote, mayRemoveNote } from './share-note';

// Comentario y nota en el dominio (D2, D3, D4 y D5 de group-comments).

const now = new Date('2026-09-19T10:00:00.000Z');
const ids = {
  groupId: '66e9a0000000000000000001',
  linkId: '66e9a0000000000000000002',
  authorId: '66e9a0000000000000000003',
};
const OTHER = '66e9a0000000000000000004';
const NULL_CHAR = String.fromCharCode(0);
const RIGHT_TO_LEFT_OVERRIDE = String.fromCharCode(0x202e);

describe('createGroupLinkComment', () => {
  it('normalizes the text and keeps who and when', () => {
    expect(
      createGroupLinkComment({
        ...ids,
        text: `  Piden C1\r\nya${NULL_CHAR}${RIGHT_TO_LEFT_OVERRIDE}  `,
        now,
      }),
    ).toEqual({ ...ids, text: 'Piden C1\nya', createdAt: now });
  });

  it('keeps phones, emails and HTML as written', () => {
    const text = 'Juan +591 70000000 rrhh@empresa.example <b>ojo</b>';

    expect(createGroupLinkComment({ ...ids, text, now }).text).toBe(text);
  });

  it('rejects an empty text after normalizing, naming text', () => {
    expect(() =>
      createGroupLinkComment({ ...ids, text: `  ${NULL_CHAR} `, now }),
    ).toThrow(InvalidCommentText);
    expect(new InvalidCommentText().field).toBe('text');
  });

  it('accepts 500 characters and rejects 501', () => {
    expect(
      createGroupLinkComment({ ...ids, text: 'a'.repeat(500), now }).text,
    ).toHaveLength(500);
    expect(() =>
      createGroupLinkComment({ ...ids, text: 'a'.repeat(501), now }),
    ).toThrow(InvalidCommentText);
  });
});

describe('mayDeleteComment', () => {
  const comment = { authorId: ids.authorId };

  it.each([
    ['the author, as a member', ids.authorId, 'member', true],
    ['the owner, on somebody else', OTHER, 'owner', true],
    ['the author who is also owner', ids.authorId, 'owner', true],
    ['another member', OTHER, 'member', false],
  ] as const)('%s: %s', (_case, requester, role, allowed) => {
    expect(mayDeleteComment(comment, requester, role)).toBe(allowed);
  });
});

describe('authorLeftGiven', () => {
  it('derives the mark from the current members', () => {
    const comment = { authorId: ids.authorId };

    expect(authorLeftGiven(comment, new Set([ids.authorId, OTHER]))).toBe(
      false,
    );
    expect(authorLeftGiven(comment, new Set([OTHER]))).toBe(true);
  });
});

describe('createShareNote', () => {
  it('normalizes the note', () => {
    expect(createShareNote('  Esta es la que te dije ', now)).toEqual({
      text: 'Esta es la que te dije',
      createdAt: now,
    });
  });

  it('treats a missing or empty note as no note', () => {
    expect(createShareNote(undefined, now)).toBeNull();
    expect(createShareNote(`  ${RIGHT_TO_LEFT_OVERRIDE}\r\n`, now)).toBeNull();
  });

  it('accepts 280 characters and rejects 281, naming note', () => {
    expect(createShareNote('a'.repeat(280), now)?.text).toHaveLength(280);
    expect(() => createShareNote('a'.repeat(281), now)).toThrow(
      InvalidShareNote,
    );
    expect(new InvalidShareNote().field).toBe('note');
  });
});

describe('mayRemoveNote', () => {
  it.each([
    ['who shared it', ids.authorId, 'member', true],
    ['the owner', OTHER, 'owner', true],
    ['another member', OTHER, 'member', false],
  ] as const)('%s: %s', (_case, requester, role, allowed) => {
    expect(mayRemoveNote(ids.authorId, requester, role)).toBe(allowed);
  });
});
