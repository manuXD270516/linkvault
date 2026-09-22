import { describe, expect, it } from 'vitest';
import {
  APPLICATION_NOTES_MAX_LENGTH,
  APPLICATION_STATUSES,
  APPLIED_AT_STATUSES,
  acceptsAppliedAt,
  applicationEventSchema,
  applicationListQuerySchema,
  applicationNotesSchema,
  applicationSchema,
  applicationStatusSchema,
  applicationVisibilitySchema,
  changeApplicationStatusRequestSchema,
  CLOSED_STATUSES,
  groupTrackersQuerySchema,
  groupTrackersResponseSchema,
  isClosedStatus,
  STAGE_LABEL_MAX_LENGTH,
  stageLabelSchema,
  trackLinkRequestSchema,
  trackLinkResponseSchema,
  updateApplicationRequestSchema,
} from './application.schema';

const LINK_ID = '66e9a0000000000000000001';
const DATE = '2026-09-15T00:00:00.000Z';

function fieldsOf(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[] }[] };
}): string[] {
  return (result.error?.issues ?? []).map((issue) =>
    issue.path.map(String).join('.'),
  );
}

const card = {
  id: LINK_ID,
  displayUrl: 'https://www.getonbrd.com/jobs/backend-acme',
  platform: 'getonboard',
  previewStatus: 'enriched',
  title: 'Backend Developer',
  company: 'Acme',
} as const;

const application = {
  id: '66e9a0000000000000000009',
  linkId: LINK_ID,
  status: 'in_process',
  stageLabel: 'Prueba técnica',
  visibility: 'private',
  notes: '',
  appliedAt: DATE,
  statusChangedAt: DATE,
  version: 2,
  createdAt: DATE,
  updatedAt: DATE,
  link: card,
} as const;

describe('application statuses', () => {
  it('lists the canonical statuses of ADR-004 in snake_case', () => {
    expect(APPLICATION_STATUSES).toEqual([
      'saved',
      'interested',
      'applied',
      'in_process',
      'offer',
      'accepted',
      'rejected',
      'withdrawn',
      'expired',
    ]);
    expect(applicationStatusSchema.options).toEqual([...APPLICATION_STATUSES]);
  });

  it('closes with rejected, withdrawn and expired, and accepted is not a closure', () => {
    expect(CLOSED_STATUSES).toEqual(['rejected', 'withdrawn', 'expired']);
    expect(isClosedStatus('accepted')).toBe(false);
    expect(isClosedStatus('expired')).toBe(true);
  });

  it('admits appliedAt only with the four applied statuses', () => {
    expect(APPLIED_AT_STATUSES).toEqual([
      'applied',
      'in_process',
      'offer',
      'accepted',
    ]);
    expect(
      APPLICATION_STATUSES.filter((status) => acceptsAppliedAt(status)),
    ).toEqual([...APPLIED_AT_STATUSES]);
  });

  it('rejects an unknown status', () => {
    expect(applicationStatusSchema.safeParse('hired').success).toBe(false);
  });

  it('has a private or group visibility', () => {
    expect(applicationVisibilitySchema.options).toEqual(['private', 'group']);
  });
});

describe('stageLabelSchema', () => {
  it.each([
    ['', false],
    ['   ', false],
    ['a', true],
    ['a'.repeat(STAGE_LABEL_MAX_LENGTH), true],
    ['a'.repeat(STAGE_LABEL_MAX_LENGTH + 1), false],
    [`  ${'a'.repeat(STAGE_LABEL_MAX_LENGTH)}  `, true],
  ])('stage %j is valid: %s', (label, valid) => {
    expect(stageLabelSchema.safeParse(label).success).toBe(valid);
  });

  it('trims the outer spaces', () => {
    expect(stageLabelSchema.parse('  Prueba técnica ')).toBe('Prueba técnica');
  });
});

describe('applicationNotesSchema', () => {
  it.each([
    ['', true],
    ['Piden inglés C1', true],
    ['a'.repeat(APPLICATION_NOTES_MAX_LENGTH), true],
    ['a'.repeat(APPLICATION_NOTES_MAX_LENGTH + 1), false],
  ])('notes of length %# are valid: %s', (notes, valid) => {
    expect(applicationNotesSchema.safeParse(notes).success).toBe(valid);
  });
});

describe('trackLinkRequestSchema', () => {
  it('accepts a link and a status', () => {
    expect(
      trackLinkRequestSchema.parse({ linkId: LINK_ID, status: 'applied' }),
    ).toEqual({ linkId: LINK_ID, status: 'applied' });
  });

  it('keeps a malformed link id for the domain to answer link_not_found', () => {
    expect(
      trackLinkRequestSchema.safeParse({
        linkId: 'no-es-un-id',
        status: 'interested',
      }).success,
    ).toBe(true);
  });

  it('names status when it is unknown', () => {
    expect(
      fieldsOf(
        trackLinkRequestSchema.safeParse({ linkId: LINK_ID, status: 'hired' }),
      ),
    ).toEqual(['status']);
  });

  it('accepts a stage with in_process and trims it', () => {
    expect(
      trackLinkRequestSchema.parse({
        linkId: LINK_ID,
        status: 'in_process',
        stageLabel: '  Entrevista ',
      }),
    ).toMatchObject({ stageLabel: 'Entrevista' });
  });

  it('names stageLabel when a stage comes with applied', () => {
    expect(
      fieldsOf(
        trackLinkRequestSchema.safeParse({
          linkId: LINK_ID,
          status: 'applied',
          stageLabel: 'Entrevista',
        }),
      ),
    ).toEqual(['stageLabel']);
  });

  it('accepts appliedAt with applied and names it with interested', () => {
    expect(
      trackLinkRequestSchema.safeParse({
        linkId: LINK_ID,
        status: 'applied',
        appliedAt: DATE,
      }).success,
    ).toBe(true);
    expect(
      fieldsOf(
        trackLinkRequestSchema.safeParse({
          linkId: LINK_ID,
          status: 'interested',
          appliedAt: DATE,
        }),
      ),
    ).toEqual(['appliedAt']);
  });

  it('accepts an ISO date with an offset, as a local midnight', () => {
    expect(
      trackLinkRequestSchema.safeParse({
        linkId: LINK_ID,
        status: 'applied',
        appliedAt: '2026-09-15T00:00:00-04:00',
      }).success,
    ).toBe(true);
  });

  it('names appliedAt when it is not a date', () => {
    expect(
      fieldsOf(
        trackLinkRequestSchema.safeParse({
          linkId: LINK_ID,
          status: 'applied',
          appliedAt: 'ayer',
        }),
      ),
    ).toEqual(['appliedAt']);
  });
});

describe('changeApplicationStatusRequestSchema', () => {
  const base = { status: 'in_process', version: 3 } as const;

  it('accepts a status with its version', () => {
    expect(changeApplicationStatusRequestSchema.parse(base)).toEqual(base);
  });

  it('accepts an optional groupId from a group view', () => {
    expect(
      changeApplicationStatusRequestSchema.parse({ ...base, groupId: 'g1' }),
    ).toEqual({ ...base, groupId: 'g1' });
    expect(changeApplicationStatusRequestSchema.parse(base)).not.toHaveProperty(
      'groupId',
    );
  });

  it('names version when it is missing or not a positive integer', () => {
    expect(
      fieldsOf(
        changeApplicationStatusRequestSchema.safeParse({ status: 'applied' }),
      ),
    ).toEqual(['version']);
    expect(
      fieldsOf(
        changeApplicationStatusRequestSchema.safeParse({ ...base, version: 0 }),
      ),
    ).toEqual(['version']);
  });

  it('tells an omitted stage from a null stage', () => {
    expect(changeApplicationStatusRequestSchema.parse(base)).not.toHaveProperty(
      'stageLabel',
    );
    expect(
      changeApplicationStatusRequestSchema.parse({ ...base, stageLabel: null }),
    ).toEqual({ ...base, stageLabel: null });
  });

  it.each(APPLICATION_STATUSES)('admits a null stage with %s', (status) => {
    expect(
      changeApplicationStatusRequestSchema.safeParse({
        status,
        version: 1,
        stageLabel: null,
      }).success,
    ).toBe(true);
  });

  it('names stageLabel when a stage comes with applied', () => {
    expect(
      fieldsOf(
        changeApplicationStatusRequestSchema.safeParse({
          status: 'applied',
          version: 1,
          stageLabel: 'Entrevista',
        }),
      ),
    ).toEqual(['stageLabel']);
  });

  it('accepts appliedAt with offer and names it with interested', () => {
    expect(
      changeApplicationStatusRequestSchema.safeParse({
        status: 'offer',
        version: 1,
        appliedAt: DATE,
      }).success,
    ).toBe(true);
    expect(
      fieldsOf(
        changeApplicationStatusRequestSchema.safeParse({
          status: 'interested',
          version: 1,
          appliedAt: DATE,
        }),
      ),
    ).toEqual(['appliedAt']);
  });

  it.each(['saved', 'interested', 'rejected', 'withdrawn', 'expired'] as const)(
    'names appliedAt with %s',
    (status) => {
      expect(
        fieldsOf(
          changeApplicationStatusRequestSchema.safeParse({
            status,
            version: 1,
            appliedAt: DATE,
          }),
        ),
      ).toEqual(['appliedAt']);
    },
  );
});

describe('updateApplicationRequestSchema', () => {
  it('accepts notes, visibility or both', () => {
    expect(updateApplicationRequestSchema.parse({ notes: '' })).toEqual({
      notes: '',
    });
    expect(
      updateApplicationRequestSchema.parse({ visibility: 'group' }),
    ).toEqual({ visibility: 'group' });
    expect(
      updateApplicationRequestSchema.safeParse({
        notes: 'x',
        visibility: 'private',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty body without naming a field', () => {
    const result = updateApplicationRequestSchema.safeParse({});

    expect(result.success).toBe(false);
    expect(fieldsOf(result)).toEqual(['']);
  });

  it('names notes when they are too long', () => {
    expect(
      fieldsOf(
        updateApplicationRequestSchema.safeParse({
          notes: 'a'.repeat(APPLICATION_NOTES_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['notes']);
  });

  it('names visibility when it is unknown', () => {
    expect(
      fieldsOf(updateApplicationRequestSchema.safeParse({ visibility: 'all' })),
    ).toEqual(['visibility']);
  });
});

describe('linkIds in the queries', () => {
  const ids = (count: number): string =>
    Array.from({ length: count }, (_, index) => `id${index}`).join(',');

  it('splits, trims and deduplicates the list', () => {
    expect(groupTrackersQuerySchema.parse({ linkIds: ' a, b ,a,,c ' })).toEqual(
      { linkIds: ['a', 'b', 'c'] },
    );
  });

  it('accepts 50 ids and names linkIds with 51', () => {
    expect(
      groupTrackersQuerySchema.safeParse({ linkIds: ids(50) }).success,
    ).toBe(true);
    expect(
      fieldsOf(groupTrackersQuerySchema.safeParse({ linkIds: ids(51) })),
    ).toEqual(['linkIds']);
  });

  it('counts the ids after removing duplicates', () => {
    expect(
      groupTrackersQuerySchema.safeParse({ linkIds: `${ids(50)},id0,id1` })
        .success,
    ).toBe(true);
  });

  it('names linkIds when there is none', () => {
    expect(fieldsOf(groupTrackersQuerySchema.safeParse({}))).toEqual([
      'linkIds',
    ]);
    expect(
      fieldsOf(groupTrackersQuerySchema.safeParse({ linkIds: ' , ' })),
    ).toEqual(['linkIds']);
  });

  it('makes linkIds optional in the list of own applications', () => {
    expect(applicationListQuerySchema.parse({})).toEqual({});
    expect(applicationListQuerySchema.parse({ linkIds: 'a,b' })).toEqual({
      linkIds: ['a', 'b'],
    });
    expect(
      fieldsOf(applicationListQuerySchema.safeParse({ linkIds: ids(51) })),
    ).toEqual(['linkIds']);
  });
});

describe('response schemas', () => {
  it('accepts an application with its link card', () => {
    expect(applicationSchema.parse(application)).toEqual(application);
    expect(
      trackLinkResponseSchema.parse({ application, created: false }),
    ).toEqual({ application, created: false });
  });

  it('accepts a card without title nor company', () => {
    const bare = {
      id: card.id,
      displayUrl: card.displayUrl,
      platform: card.platform,
      previewStatus: card.previewStatus,
    };

    expect(
      applicationSchema.safeParse({ ...application, link: bare }).success,
    ).toBe(true);
  });

  it.each([
    [
      'fitScore con marca en falso',
      { ...application, fitScore: 78, fitScoreDegraded: false },
      true,
    ],
    [
      'fitScoreDegraded true a solas',
      { ...application, fitScoreDegraded: true },
      true,
    ],
    [
      'fitScore con marca en cierto',
      { ...application, fitScore: 41, fitScoreDegraded: true },
      false,
    ],
    ['fitScore solo', { ...application, fitScore: 78 }, false],
    ['ninguno de los dos', application, true],
  ] as const)('%s → válido: %s', (_label, value, valid) => {
    expect(applicationSchema.safeParse(value).success).toBe(valid);
  });

  it('representa la ausencia como campo ausente, nunca como 0', () => {
    const parsed = applicationSchema.parse(application);

    expect(parsed).not.toHaveProperty('fitScore');
    expect(parsed).not.toHaveProperty('fitScoreDegraded');
    expect(
      applicationSchema.safeParse({
        ...application,
        fitScore: 0,
        fitScoreDegraded: false,
      }).success,
    ).toBe(true);
  });

  it('requires statusChangedAt', () => {
    const withoutIt = Object.fromEntries(
      Object.entries(application).filter(([key]) => key !== 'statusChangedAt'),
    );

    expect(applicationSchema.safeParse(withoutIt).success).toBe(false);
  });

  it('accepts a first event without origin', () => {
    expect(
      applicationEventSchema.safeParse({ id: 'e1', to: 'interested', at: DATE })
        .success,
    ).toBe(true);
  });

  describe('group trackers', () => {
    const tracker = {
      userId: '66e9a00000000000000000a1',
      displayName: 'Ana',
      status: 'in_process',
    } as const;

    it('accepts a tracker with only its user, name and status', () => {
      expect(
        groupTrackersResponseSchema.parse({
          items: [{ linkId: LINK_ID, trackers: [tracker] }],
        }),
      ).toEqual({ items: [{ linkId: LINK_ID, trackers: [tracker] }] });
    });

    it.each([
      ['stageLabel', 'Entrevista con el CTO'],
      ['notes', 'nota'],
      ['fitScore', 80],
      ['applicationId', 'x'],
      ['appliedAt', DATE],
    ])('rejects a tracker carrying %s', (field, value) => {
      expect(
        groupTrackersResponseSchema.safeParse({
          items: [
            { linkId: LINK_ID, trackers: [{ ...tracker, [field]: value }] },
          ],
        }).success,
      ).toBe(false);
    });
  });
});
