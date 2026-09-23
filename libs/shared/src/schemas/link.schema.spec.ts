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
  publicShareSchema,
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
  previewVersion: 1,
  previewRequestedAt: '2026-09-17T10:00:00.000Z',
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
    expect(saveLinkRequestSchema.safeParse({ url: atLimit }).success).toBe(
      true,
    );
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

  describe('note', () => {
    const url = 'https://example.com/jobs/1';
    const groupId = '66e9a0000000000000000001';

    it('Guardar con una nota: normalizes it', () => {
      expect(
        saveLinkRequestSchema.parse({
          url,
          groupId,
          note: '  Esta es la que te dije ',
        }),
      ).toEqual({ url, groupId, note: 'Esta es la que te dije' });
    });

    it('Nota sin grupo: names note', () => {
      const result = saveLinkRequestSchema.safeParse({ url, note: 'Para mí' });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
        'note',
      ]);
    });

    it('Nota vacía sin grupo: behaves as if no note was sent', () => {
      expect(saveLinkRequestSchema.parse({ url, note: '   ' })).toEqual({
        url,
      });
      expect(
        saveLinkRequestSchema.parse({ url, groupId, note: '\u202E \r\n' }),
      ).toEqual({ url, groupId });
    });

    it('Nota demasiado larga: 280 characters fit and 281 name note', () => {
      expect(
        saveLinkRequestSchema.safeParse({
          url,
          groupId,
          note: 'a'.repeat(280),
        }).success,
      ).toBe(true);
      const result = saveLinkRequestSchema.safeParse({
        url,
        groupId,
        note: 'a'.repeat(281),
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
        'note',
      ]);
    });
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
    expect(
      importLinksRequestSchema.safeParse({ text: overLimit }).success,
    ).toBe(true);
  });

  it('rejects an empty text and one past the sanity bound', () => {
    expect(importLinksRequestSchema.safeParse({ text: '' }).success).toBe(
      false,
    );
    expect(
      importLinksRequestSchema.safeParse({
        text: 'a'.repeat(IMPORT_TEXT_INPUT_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it('exposes the text limits', () => {
    expect(IMPORT_TEXT_MAX_LENGTH).toBe(20_000);
    expect(IMPORT_TEXT_INPUT_MAX_LENGTH).toBeGreaterThan(
      IMPORT_TEXT_MAX_LENGTH,
    );
  });
});

describe('jobLinkSummarySchema', () => {
  it('accepts exactly the summary fields', () => {
    expect(jobLinkSummarySchema.parse(summary)).toEqual(summary);
  });

  it('accepts a group link with its note and its comments summary', () => {
    const inGroup = {
      ...summary,
      note: { text: 'Esta es la que te dije', createdAt: summary.sharedAt },
      comments: {
        count: 0,
        revision: 0,
        sharedAt: summary.sharedAt,
        latest: [],
      },
    };

    expect(jobLinkSummarySchema.parse(inGroup)).toEqual(inGroup);
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

  it('keeps taking a link with no preview at all', () => {
    const parsed = jobLinkSummarySchema.parse(summary);

    expect(parsed.preview).toBeUndefined();
    expect(parsed.previewSources).toBeUndefined();
    expect(parsed.lastEnrichmentError).toBeUndefined();
    expect(parsed.closedAt).toBeUndefined();
    expect(parsed.closedReason).toBeUndefined();
  });

  it('accepts a closed vacancy with closedAt and closedReason', () => {
    const closed = {
      ...summary,
      closedAt: '2026-09-22T12:00:00.000Z',
      closedReason: 'calendar' as const,
    };
    expect(jobLinkSummarySchema.parse(closed)).toEqual(closed);
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        closedReason: 'recheck',
      }).success,
    ).toBe(true);
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        closedReason: 'unknown',
      }).success,
    ).toBe(false);
  });

  it('always carries the preview version, so a late notice can be told apart', () => {
    const { previewVersion: _missing, ...without } = summary;

    expect(jobLinkSummarySchema.safeParse(without).success).toBe(false);
    expect(
      jobLinkSummarySchema.safeParse({ ...summary, previewVersion: 0 }).success,
    ).toBe(false);
  });

  it('takes a link saved before the enrichment, without when its reading was asked for', () => {
    const { previewRequestedAt: _legacy, ...older } = summary;

    expect(jobLinkSummarySchema.safeParse(older).success).toBe(true);
  });

  it('takes an enriched link with its preview, its provenance and its last failure', () => {
    const enriched = {
      ...summary,
      previewStatus: 'partial',
      preview: { title: 'Backend Engineer' },
      previewSources: {
        title: {
          value: 'Backend Engineer',
          source: 'auto',
          extractor: 'json-ld',
          at: '2026-09-17T10:05:00.000Z',
        },
      },
      lastEnrichmentError: {
        reason: 'no_data',
        at: '2026-09-17T10:05:00.000Z',
      },
    } as const;

    expect(jobLinkSummarySchema.parse(enriched)).toEqual(enriched);
  });

  it('answers who wrote a field by name, not by identifier', () => {
    const manual = {
      value: 'Backend Engineer II',
      source: 'manual',
      at: '2026-09-18T10:00:00.000Z',
    } as const;

    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        previewSources: { title: { ...manual, by: 'u1' } },
      }).success,
    ).toBe(false);
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        previewSources: {
          title: { ...manual, by: { userId: 'u1', displayName: 'Ana' } },
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a preview field that is not in the preview and an unknown failure reason', () => {
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        preview: { image: 'https://cdn/x.png' },
      }).success,
    ).toBe(false);
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        lastEnrichmentError: { reason: 'oops', at: '2026-09-17T10:05:00.000Z' },
      }).success,
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

describe('publicShareSchema en jobLinkSummarySchema', () => {
  const share = {
    slug: 'k7m2p9r4t6vw',
    url: 'https://linkvault.example/p/k7m2p9r4t6vw',
    publishedAt: '2026-09-19T10:00:00.000Z',
  } as const;

  it('el listado de un grupo acepta el enlace público', () => {
    const published = { ...summary, publicShare: share };

    expect(jobLinkSummarySchema.parse(published)).toEqual(published);
  });

  it('un link sin publicar no lo lleva', () => {
    expect(jobLinkSummarySchema.parse(summary)).not.toHaveProperty(
      'publicShare',
    );
  });

  it('rechaza un slug mal formado', () => {
    expect(
      jobLinkSummarySchema.safeParse({
        ...summary,
        publicShare: { ...share, slug: 'NO-ES-UN-SLUG' },
      }).success,
    ).toBe(false);
  });

  it('no dice quién lo publicó', () => {
    expect(
      publicShareSchema.safeParse({ ...share, publishedBy: 'u1' }).success,
    ).toBe(false);
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
