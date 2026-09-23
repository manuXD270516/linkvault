import { describe, expect, it } from 'vitest';
import {
  GROUP_LINK_TAG_MAX_COUNT,
  listGroupLinksQuerySchema,
  normalizeGroupLinkTag,
  normalizeGroupLinkTags,
  setGroupLinkPinnedRequestSchema,
  setGroupLinkTagsRequestSchema,
} from './group-link-tags-pinned.schema';

describe('normalizeGroupLinkTag', () => {
  it('trims, lowercases and collapses internal spaces', () => {
    expect(normalizeGroupLinkTag('  Remote  Work  ')).toBe('remote work');
  });
});

describe('normalizeGroupLinkTags', () => {
  it('discards empties, dedupes and keeps first-seen order', () => {
    expect(
      normalizeGroupLinkTags(['Remote', ' remote ', '', '  ', 'Backend', 'remote']),
    ).toEqual(['remote', 'backend']);
  });
});

describe('setGroupLinkTagsRequestSchema', () => {
  it('normalizes and dedupes like the replace scenario', () => {
    expect(
      setGroupLinkTagsRequestSchema.parse({
        tags: ['Remote', ' remote ', 'Backend'],
      }),
    ).toEqual({ tags: ['remote', 'backend'] });
  });

  it('accepts an empty array to clear all tags', () => {
    expect(setGroupLinkTagsRequestSchema.parse({ tags: [] })).toEqual({
      tags: [],
    });
    expect(setGroupLinkTagsRequestSchema.parse({ tags: ['  ', ''] })).toEqual({
      tags: [],
    });
  });

  it('rejects more than 8 distinct tags after normalize', () => {
    const tags = Array.from(
      { length: GROUP_LINK_TAG_MAX_COUNT + 1 },
      (_, i) => `tag-${i}`,
    );
    expect(setGroupLinkTagsRequestSchema.safeParse({ tags }).success).toBe(
      false,
    );
  });

  it('rejects a tag that fails the pattern after normalize', () => {
    expect(
      setGroupLinkTagsRequestSchema.safeParse({ tags: ['!!!'] }).success,
    ).toBe(false);
    expect(
      setGroupLinkTagsRequestSchema.safeParse({ tags: ['-leading'] }).success,
    ).toBe(false);
  });

  it('rejects missing tags or unknown fields', () => {
    expect(setGroupLinkTagsRequestSchema.safeParse({}).success).toBe(false);
    expect(
      setGroupLinkTagsRequestSchema.safeParse({
        tags: ['ok'],
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe('setGroupLinkPinnedRequestSchema', () => {
  it('accepts a boolean pinned', () => {
    expect(setGroupLinkPinnedRequestSchema.parse({ pinned: true })).toEqual({
      pinned: true,
    });
    expect(setGroupLinkPinnedRequestSchema.parse({ pinned: false })).toEqual({
      pinned: false,
    });
  });

  it('rejects string booleans and missing pinned', () => {
    expect(
      setGroupLinkPinnedRequestSchema.safeParse({ pinned: 'true' }).success,
    ).toBe(false);
    expect(setGroupLinkPinnedRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('listGroupLinksQuerySchema', () => {
  it('defaults limit and leaves filters absent', () => {
    expect(listGroupLinksQuerySchema.parse({})).toEqual({ limit: 20 });
  });

  it('parses pinned=true|false without coerce.boolean', () => {
    expect(listGroupLinksQuerySchema.parse({ pinned: 'true' })).toEqual({
      limit: 20,
      pinned: true,
    });
    expect(listGroupLinksQuerySchema.parse({ pinned: 'false' })).toEqual({
      limit: 20,
      pinned: false,
    });
  });

  it('"false" must not become true', () => {
    const parsed = listGroupLinksQuerySchema.parse({ pinned: 'false' });
    expect(parsed.pinned).toBe(false);
  });

  it('rejects coerce-style truthy strings for pinned', () => {
    expect(
      listGroupLinksQuerySchema.safeParse({ pinned: '1' }).success,
    ).toBe(false);
    expect(
      listGroupLinksQuerySchema.safeParse({ pinned: 'yes' }).success,
    ).toBe(false);
    expect(
      listGroupLinksQuerySchema.safeParse({ pinned: true }).success,
    ).toBe(false);
  });

  it('normalizes tag like PUT', () => {
    expect(listGroupLinksQuerySchema.parse({ tag: '  Remote  ' })).toEqual({
      limit: 20,
      tag: 'remote',
    });
  });

  it('rejects an invalid tag query', () => {
    expect(listGroupLinksQuerySchema.safeParse({ tag: '!!!' }).success).toBe(
      false,
    );
    expect(listGroupLinksQuerySchema.safeParse({ tag: '  ' }).success).toBe(
      false,
    );
  });
});
