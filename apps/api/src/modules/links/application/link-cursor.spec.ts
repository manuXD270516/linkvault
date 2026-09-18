import { describe, expect, it } from 'vitest';
import { InvalidCursor } from '../domain/errors';
import { decodeCursor, encodeCursor, toLinkListQuery } from './link-cursor';

const cursor = {
  date: new Date('2026-09-17T10:00:00.000Z'),
  relationId: '66e9a0000000000000000001',
};

describe('encodeCursor and decodeCursor', () => {
  it('goes there and back', () => {
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('is opaque: it carries neither the date nor the id in plain sight', () => {
    const encoded = encodeCursor(cursor);

    expect(encoded).not.toContain('2026');
    expect(encoded).not.toContain(cursor.relationId);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('is stable for the same position', () => {
    expect(encodeCursor(cursor)).toBe(encodeCursor({ ...cursor }));
  });

  it.each([
    ['', 'empty'],
    ['not-a-cursor', 'not base64url'],
    [Buffer.from('2026-09-17T10:00:00.000Z', 'utf8').toString('base64url'), 'without the id'],
    [Buffer.from('ayer|66e9a0000000000000000001', 'utf8').toString('base64url'), 'with an impossible date'],
    [Buffer.from('2026-09-17T10:00:00.000Z|no-es-un-id', 'utf8').toString('base64url'), 'with a malformed id'],
  ])('rejects a cursor %j (%s)', (raw) => {
    expect(() => decodeCursor(raw)).toThrow(InvalidCursor);
  });

  it('names the cursor field, so the response says which one it is', () => {
    expect(new InvalidCursor().field).toBe('cursor');
    expect(new InvalidCursor().code).toBe('validation_error');
  });
});

describe('toLinkListQuery', () => {
  it('keeps the limit and leaves out the cursor of a first page', () => {
    expect(toLinkListQuery({ limit: 20 })).toEqual({ limit: 20 });
  });

  it('decodes the cursor of the following pages', () => {
    expect(
      toLinkListQuery({ limit: 50, cursor: encodeCursor(cursor) }),
    ).toEqual({ limit: 50, cursor });
  });

  it('rejects a manipulated cursor', () => {
    expect(() => toLinkListQuery({ limit: 20, cursor: 'roto' })).toThrow(
      InvalidCursor,
    );
  });
});
