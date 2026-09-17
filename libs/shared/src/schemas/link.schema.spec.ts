import { describe, expect, it } from 'vitest';
import {
  alreadyInGroupSchema,
  IMPORT_TEXT_INPUT_MAX_LENGTH,
  IMPORT_TEXT_MAX_LENGTH,
  importLinksRequestSchema,
  importLinksResponseSchema,
  jobLinkSummarySchema,
  LINK_CURSOR_INPUT_MAX_LENGTH,
  LINK_PAGE_DEFAULT_LIMIT,
  LINK_PAGE_MAX_LIMIT,
  LINK_URL_INPUT_MAX_LENGTH,
  LINK_URL_MAX_LENGTH,
  linkPageSchema,
  listLinksQuerySchema,
  platformSchema,
  previewStatusSchema,
  saveLinkRequestSchema,
  saveLinkResponseSchema,
  shareOutcomeSchema,
} from './link.schema';

const summary = {
  id: '66e9a0000000000000000001',
  normalizedUrl: 'https://linkedin.com/jobs/view/3811111111',
  displayUrl: 'https://www.linkedin.com/jobs/view/3811111111/?utm_source=wa',
  platform: 'linkedin',
  previewStatus: 'pending',
  sharedBy: { userId: '66e9a0000000000000000002', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
} as const;

describe('platformSchema', () => {
  it('lists the platforms with a canonicalizer plus generic', () => {
    expect(platformSchema.options).toEqual([
      'linkedin',
      'computrabajo',
      'indeed',
      'trabajopolis',
      'getonboard',
      'generic',
    ]);
  });
});

describe('previewStatusSchema', () => {
  it('lists every preview state', () => {
    expect(previewStatusSchema.options).toEqual([
      'pending',
      'enriched',
      'partial',
      'failed',
      'manual',
    ]);
  });
});

describe('saveLinkRequestSchema', () => {
  it('accepts a url with an optional group', () => {
    expect(
      saveLinkRequestSchema.parse({
        url: '  https://example.com/jobs/1  ',
        groupId: ' 66e9a0000000000000000001 ',
      }),
    ).toEqual({
      url: 'https://example.com/jobs/1',
      groupId: '66e9a0000000000000000001',
    });
  });

  it('accepts a url without a group', () => {
    expect(saveLinkRequestSchema.parse({ url: 'https://example.com' })).toEqual(
      { url: 'https://example.com' },
    );
  });

  it.each([
    ['', false],
    ['   ', false],
    // Ni el esquema ni el formato se juzgan aquí: el dominio responde `invalid_url`.
    ['no-es-una-url', true],
    ['ftp://example.com/job', true],
    ['javascript:alert(1)', true],
  ])('url %j is valid: %s', (url, valid) => {
    expect(saveLinkRequestSchema.safeParse({ url }).success).toBe(valid);
  });

  it('leaves the business limit of 2048 characters to the domain', () => {
    const atLimit = `https://example.com/${'a'.repeat(LINK_URL_MAX_LENGTH - 20)}`;
    const overLimit = `https://example.com/${'a'.repeat(LINK_URL_MAX_LENGTH)}`;

    expect(atLimit).toHaveLength(LINK_URL_MAX_LENGTH);
    expect(saveLinkRequestSchema.safeParse({ url: atLimit }).success).toBe(true);
    // Pasa el contrato HTTP para que el dominio pueda responder `invalid_url` en vez de `validation_error`.
    expect(saveLinkRequestSchema.safeParse({ url: overLimit }).success).toBe(
      true,
    );
  });

  it('rejects a url past the sanity bound', () => {
    expect(
      saveLinkRequestSchema.safeParse({
        url: `https://example.com/${'a'.repeat(LINK_URL_INPUT_MAX_LENGTH)}`,
      }).success,
    ).toBe(false);
  });

  it('rejects a group identifier past the sanity bound', () => {
    expect(
      saveLinkRequestSchema.safeParse({
        url: 'https://example.com',
        groupId: 'a'.repeat(65),
      }).success,
    ).toBe(false);
  });

  it('names the offending field', () => {
    const result = saveLinkRequestSchema.safeParse({ url: '  ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual(['url']);
  });

  it('exposes the url limits', () => {
    expect(LINK_URL_MAX_LENGTH).toBe(2048);
    expect(LINK_URL_INPUT_MAX_LENGTH).toBeGreaterThan(LINK_URL_MAX_LENGTH);
  });
});

describe('importLinksRequestSchema', () => {
  it('keeps the pasted text as it was written', () => {
    const text = '  Ana: mira esto\nhttps://example.com/jobs/1  ';

    expect(importLinksRequestSchema.parse({ text })).toEqual({ text });
  });

  it('leaves the business limit of 20 000 characters to the domain', () => {
    const atLimit = 'a'.repeat(IMPORT_TEXT_MAX_LENGTH);
    const overLimit = 'a'.repeat(IMPORT_TEXT_MAX_LENGTH + 1);

    expect(importLinksRequestSchema.safeParse({ text: atLimit }).success).toBe(
      true,
    );
    // Pasa el contrato HTTP para que el dominio pueda responder `text_too_long` en vez de `validation_error`.
    expect(importLinksRequestSchema.safeParse({ text: overLimit }).success).toBe(
      true,
    );
  });

  it('rejects an empty text and one past the sanity bound', () => {
    expect(importLinksRequestSchema.safeParse({ text: '' }).success).toBe(false);
    expect(
      importLinksRequestSchema.safeParse({
        text: 'a'.repeat(IMPORT_TEXT_INPUT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('exposes the text limits', () => {
    expect(IMPORT_TEXT_MAX_LENGTH).toBe(20_000);
    expect(IMPORT_TEXT_INPUT_MAX_LENGTH).toBeGreaterThan(IMPORT_TEXT_MAX_LENGTH);
  });
});

describe('jobLinkSummarySchema', () => {
  it('accepts exactly the summary fields', () => {
    expect(jobLinkSummarySchema.parse(summary)).toEqual(summary);
  });

  it('accepts a private link with no sharer', () => {
    const { sharedBy: _sharedBy, ...privateLink } = summary;

    expect(jobLinkSummarySchema.parse(privateLink)).toEqual(privateLink);
  });

  it('rejects the email of the sharer and any unknown field', () => {
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        sharedBy: { ...summary.sharedBy, email: 'ana@example.com' },
      }).success,
    ).toBe(false);
    expect(
      jobLinkSummarySchema.safeParse({ ...summary, urlHash: 'abc' }).success,
    ).toBe(false);
  });
});

describe('saveLinkResponseSchema', () => {
  const response = {
    link: summary,
    created: true,
    shared: 'created',
    alreadyInGroups: [],
  } as const;

  it('accepts a link saved for the first time', () => {
    expect(saveLinkResponseSchema.parse(response)).toEqual(response);
  });

  it('accepts a link that was already there with its first sharer', () => {
    const alreadyThere = {
      ...response,
      created: false,
      shared: 'already_there',
      sharedBy: { userId: '66e9a0000000000000000002', displayName: 'Ana' },
      alreadyInGroups: [
        { id: '66e9a0000000000000000003', name: 'Backend Bolivia' },
      ],
    } as const;

    expect(saveLinkResponseSchema.parse(alreadyThere)).toEqual(alreadyThere);
  });

  it('rejects an unknown share outcome', () => {
    expect(shareOutcomeSchema.options).toEqual(['created', 'already_there']);
    expect(
      saveLinkResponseSchema.safeParse({ ...response, shared: 'maybe' })
        .success,
    ).toBe(false);
  });

  it('requires alreadyInGroups even when empty', () => {
    const { alreadyInGroups: _groups, ...withoutGroups } = response;

    expect(saveLinkResponseSchema.safeParse(withoutGroups).success).toBe(false);
  });
});

describe('alreadyInGroupSchema', () => {
  it('carries only the group id and name', () => {
    expect(
      alreadyInGroupSchema.safeParse({
        id: '66e9a0000000000000000003',
        name: 'Backend Bolivia',
        role: 'owner',
      }).success,
    ).toBe(false);
  });
});

describe('importLinksResponseSchema', () => {
  it('accepts the summary of an import', () => {
    const response = {
      created: 2,
      existing: 1,
      unrecognized: 0,
      skipped: 0,
      links: [summary],
    } as const;

    expect(importLinksResponseSchema.parse(response)).toEqual(response);
  });

  it('rejects negative counters', () => {
    expect(
      importLinksResponseSchema.safeParse({
        created: -1,
        existing: 0,
        unrecognized: 0,
        skipped: 0,
        links: [],
      }).success,
    ).toBe(false);
  });
});

describe('listLinksQuerySchema', () => {
  it('defaults to 20 items per page', () => {
    expect(listLinksQuerySchema.parse({})).toEqual({
      limit: LINK_PAGE_DEFAULT_LIMIT,
    });
  });

  it('reads the limit that arrives as text in the query string', () => {
    expect(listLinksQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
  });

  it.each([
    ['0', false],
    ['1', true],
    ['50', true],
    ['51', false],
    ['20.5', false],
    ['muchos', false],
  ])('limit %j is valid: %s', (limit, valid) => {
    expect(listLinksQuerySchema.safeParse({ limit }).success).toBe(valid);
  });

  it('carries the cursor as an opaque string', () => {
    expect(listLinksQuerySchema.parse({ cursor: 'abc.def' })).toEqual({
      limit: LINK_PAGE_DEFAULT_LIMIT,
      cursor: 'abc.def',
    });
    expect(
      listLinksQuerySchema.safeParse({
        cursor: 'a'.repeat(LINK_CURSOR_INPUT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('exposes the page limits', () => {
    expect(LINK_PAGE_DEFAULT_LIMIT).toBe(20);
    expect(LINK_PAGE_MAX_LIMIT).toBe(50);
  });
});

describe('linkPageSchema', () => {
  it('carries the items, the total and the next cursor', () => {
    const page = {
      items: [summary],
      total: 42,
      nextCursor: 'MjAyNi0wOS0xN1QxMDowMDowMC4wMDBa',
    } as const;

    expect(linkPageSchema.parse(page)).toEqual(page);
  });

  it('accepts a last page without a cursor', () => {
    expect(linkPageSchema.parse({ items: [], total: 0 })).toEqual({
      items: [],
      total: 0,
    });
  });

  it('requires the total', () => {
    expect(linkPageSchema.safeParse({ items: [] }).success).toBe(false);
  });
});
