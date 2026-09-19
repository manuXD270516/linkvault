import { describe, expect, it } from 'vitest';
import {
  COMMENT_PAGE_DEFAULT_LIMIT,
  COMMENT_PAGE_MAX_LIMIT,
  commentPageSchema,
  commentsSummarySchema,
  commentTextSchema,
  createCommentRequestSchema,
  createCommentResponseSchema,
  deleteCommentResponseSchema,
  groupLinkCommentSchema,
  listCommentsQuerySchema,
  shareNoteSchema,
} from './group-link-comment.schema';

// Contratos de comentarios y notas (D10 de group-comments).

const comment = {
  id: '66e9a0000000000000000003',
  author: { userId: '66e9a0000000000000000004', displayName: 'Beto' },
  authorLeft: false,
  text: 'Piden inglés C1',
  createdAt: '2026-09-19T11:00:00.000Z',
};

const summary = {
  count: 1,
  revision: 1,
  sharedAt: '2026-09-19T10:00:00.000Z',
  latest: [comment],
};

describe('commentTextSchema', () => {
  it('rejects an empty text and one with only spaces', () => {
    expect(commentTextSchema.safeParse('').success).toBe(false);
    expect(commentTextSchema.safeParse('   \r\n  ').success).toBe(false);
  });

  it('accepts exactly 500 characters and rejects 501', () => {
    expect(commentTextSchema.safeParse('a'.repeat(500)).success).toBe(true);
    expect(commentTextSchema.safeParse('a'.repeat(501)).success).toBe(false);
  });

  it('measures after trimming: 500 characters surrounded by spaces fit', () => {
    expect(commentTextSchema.parse(`   ${'a'.repeat(500)}   `)).toBe(
      'a'.repeat(500),
    );
  });

  it('measures in code points', () => {
    expect(commentTextSchema.safeParse('😢'.repeat(500)).success).toBe(true);
  });

  it('normalizes what it lets through', () => {
    expect(commentTextSchema.parse(' a\r\nb\u0000\u202E ')).toBe('a\nb');
  });

  it('names text when the request body is invalid', () => {
    const result = createCommentRequestSchema.safeParse({ text: '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['text']);
  });
});

describe('listCommentsQuerySchema', () => {
  it('pages by 20 by default and by 50 at most', () => {
    expect(listCommentsQuerySchema.parse({})).toEqual({
      limit: COMMENT_PAGE_DEFAULT_LIMIT,
    });
    expect(COMMENT_PAGE_DEFAULT_LIMIT).toBe(20);
    expect(COMMENT_PAGE_MAX_LIMIT).toBe(50);
    expect(listCommentsQuerySchema.parse({ limit: '50', cursor: 'abc' })).toEqual(
      { limit: 50, cursor: 'abc' },
    );
    expect(listCommentsQuerySchema.safeParse({ limit: '51' }).success).toBe(
      false,
    );
  });
});

describe('response contracts', () => {
  it('accepts a comment, a summary and a page', () => {
    expect(groupLinkCommentSchema.parse(comment)).toEqual(comment);
    expect(commentsSummarySchema.parse(summary)).toEqual(summary);
    expect(
      createCommentResponseSchema.parse({ comment, comments: summary }),
    ).toEqual({ comment, comments: summary });
    expect(deleteCommentResponseSchema.parse({ comments: summary })).toEqual({
      comments: summary,
    });
    expect(
      commentPageSchema.parse({ items: [comment], total: 1, nextCursor: 'x' }),
    ).toEqual({ items: [comment], total: 1, nextCursor: 'x' });
  });

  it('rejects an email in the author', () => {
    expect(
      groupLinkCommentSchema.safeParse({
        ...comment,
        author: { ...comment.author, email: 'beto@example.com' },
      }).success,
    ).toBe(false);
  });

  it('rejects three latest comments', () => {
    expect(
      commentsSummarySchema.safeParse({
        ...summary,
        count: 3,
        latest: [comment, comment, comment],
      }).success,
    ).toBe(false);
  });

  it('rejects a negative or fractional revision', () => {
    expect(
      commentsSummarySchema.safeParse({ ...summary, revision: -1 }).success,
    ).toBe(false);
    expect(
      commentsSummarySchema.safeParse({ ...summary, revision: 1.5 }).success,
    ).toBe(false);
  });

  it('accepts an empty summary at revision 0', () => {
    expect(
      commentsSummarySchema.safeParse({ ...summary, count: 0, revision: 0, latest: [] })
        .success,
    ).toBe(true);
  });

  it('rejects a delete response with anything else than the summary', () => {
    expect(
      deleteCommentResponseSchema.safeParse({ comments: summary, comment })
        .success,
    ).toBe(false);
  });
});

describe('shareNoteSchema', () => {
  it('keeps the text and its creation date, and nothing else', () => {
    const note = { text: 'Esta es la que te dije', createdAt: comment.createdAt };

    expect(shareNoteSchema.parse(note)).toEqual(note);
    expect(
      shareNoteSchema.safeParse({ ...note, updatedAt: note.createdAt }).success,
    ).toBe(false);
    expect(
      shareNoteSchema.safeParse({ ...note, text: 'a'.repeat(281) }).success,
    ).toBe(false);
  });
});
