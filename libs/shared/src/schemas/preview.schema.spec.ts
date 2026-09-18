import { describe, expect, it } from 'vitest';
import {
  enrichmentFailureReasonSchema,
  extractJobOutputSchema,
  isPreviewFieldName,
  isRetryableEnrichmentReason,
  jobModalitySchema,
  jobPreviewSchema,
  jobSenioritySchema,
  lastEnrichmentErrorSchema,
  NON_RETRYABLE_ENRICHMENT_REASONS,
  PREVIEW_FIELD_NAME_INPUT_MAX_LENGTH,
  PREVIEW_FIELD_NAMES,
  PREVIEW_FIELD_STORED_TYPES,
  PREVIEW_LANGUAGE_KEYS,
  PREVIEW_REPLACED_KEYS,
  PREVIEW_SALARY_KEYS,
  PREVIEW_SKILL_KEYS,
  PREVIEW_SKILLS_MAX,
  PREVIEW_SOURCE_ENTRY_KEYS,
  PREVIEW_SUMMARY_MAX_LENGTH,
  previewSourcesSchema,
  resolvedPreviewSourcesSchema,
  storedPreviewSchema,
  updatePreviewRequestSchema,
} from './preview.schema';

const preview = {
  title: 'Backend Engineer',
  company: 'Acme',
  location: 'La Paz, Bolivia',
  modality: 'remote',
  seniority: 'senior',
  salary: { min: 3000, max: 4500, currency: 'USD', period: 'month' },
  skills: [{ name: 'TypeScript', required: true }],
  languages: [{ name: 'Inglés', level: 'B2' }],
  summary: 'Vacante de backend con Node y TypeScript.',
  postedAt: '2026-09-10',
  expiresAt: null,
} as const;

function issuePaths(result: {
  error?: { issues: readonly { path: readonly PropertyKey[] }[] };
}): string[] {
  return [
    ...new Set(
      (result.error?.issues ?? []).map((issue) => issue.path.join('.')),
    ),
  ].sort();
}

describe('jobPreviewSchema', () => {
  it('accepts a complete preview', () => {
    expect(jobPreviewSchema.parse(preview)).toEqual(preview);
  });

  it('rejects a modality or a seniority outside its enum', () => {
    expect(jobModalitySchema.options).toEqual([
      'remote',
      'hybrid',
      'onsite',
      'unknown',
    ]);
    expect(jobSenioritySchema.options).toEqual([
      'intern',
      'junior',
      'mid',
      'senior',
      'lead',
      'unknown',
    ]);
    expect(
      issuePaths(
        jobPreviewSchema.safeParse({ ...preview, modality: 'hibrido' }),
      ),
    ).toEqual(['modality']);
    expect(
      issuePaths(
        jobPreviewSchema.safeParse({ ...preview, seniority: 'principal' }),
      ),
    ).toEqual(['seniority']);
  });

  it('rejects forty-one skills and accepts forty', () => {
    const skills = Array.from({ length: PREVIEW_SKILLS_MAX + 1 }, (_, i) => ({
      name: `skill-${i}`,
      required: false,
    }));

    expect(
      issuePaths(jobPreviewSchema.safeParse({ ...preview, skills })),
    ).toEqual(['skills']);
    expect(
      jobPreviewSchema.safeParse({ ...preview, skills: skills.slice(1) })
        .success,
    ).toBe(true);
  });

  it('rejects a summary of six hundred and one characters', () => {
    expect(
      issuePaths(
        jobPreviewSchema.safeParse({
          ...preview,
          summary: 'a'.repeat(PREVIEW_SUMMARY_MAX_LENGTH + 1),
        }),
      ),
    ).toEqual(['summary']);
    expect(
      jobPreviewSchema.safeParse({
        ...preview,
        summary: 'a'.repeat(PREVIEW_SUMMARY_MAX_LENGTH),
      }).success,
    ).toBe(true);
  });

  it('rejects an unknown field and an empty title', () => {
    expect(
      jobPreviewSchema.safeParse({ ...preview, image: 'https://cdn/x.png' })
        .success,
    ).toBe(false);
    expect(jobPreviewSchema.safeParse({ ...preview, title: '' }).success).toBe(
      false,
    );
  });

  it('takes dates without a time of day', () => {
    expect(
      jobPreviewSchema.safeParse({ ...preview, postedAt: '2026-13-01' })
        .success,
    ).toBe(false);
    expect(
      jobPreviewSchema.safeParse({
        ...preview,
        postedAt: '2026-09-10T10:00:00.000Z',
      }).success,
    ).toBe(false);
  });
});

describe('storedPreviewSchema', () => {
  it('takes a preview with only a title, which the strict one refuses', () => {
    const partial = { title: 'Backend Engineer' } as const;

    expect(storedPreviewSchema.parse(partial)).toEqual(partial);
    expect(jobPreviewSchema.safeParse(partial).success).toBe(false);
  });

  it('takes an empty preview and still refuses an unknown field', () => {
    expect(storedPreviewSchema.parse({})).toEqual({});
    expect(storedPreviewSchema.safeParse({ image: 'x' }).success).toBe(false);
  });

  it('keeps the types of the complete preview', () => {
    expect(storedPreviewSchema.parse(preview)).toEqual(preview);
    expect(storedPreviewSchema.safeParse({ modality: 'hibrido' }).success).toBe(
      false,
    );
  });
});

describe('extractJobOutputSchema', () => {
  it('takes an answer saying it is not a job posting, without a preview', () => {
    const output = { isJobPosting: false, preview: null } as const;

    expect(extractJobOutputSchema.parse(output)).toEqual(output);
  });

  it('takes a job posting with its preview', () => {
    expect(
      extractJobOutputSchema.parse({ isJobPosting: true, preview }),
    ).toEqual({ isJobPosting: true, preview });
  });

  it('demands the discriminator and a complete preview when there is one', () => {
    expect(extractJobOutputSchema.safeParse({ preview: null }).success).toBe(
      false,
    );
    expect(
      issuePaths(
        extractJobOutputSchema.safeParse({
          isJobPosting: true,
          preview: { title: 'Backend Engineer' },
        }),
      ).length,
    ).toBeGreaterThan(0);
  });

  it('lets a job posting come without fields, which is the no_data case', () => {
    expect(
      extractJobOutputSchema.safeParse({ isJobPosting: true, preview: null })
        .success,
    ).toBe(true);
  });
});

describe('PREVIEW_FIELD_NAMES', () => {
  it('names every field of the preview and nothing else', () => {
    expect([...PREVIEW_FIELD_NAMES]).toEqual(
      Object.keys(jobPreviewSchema.shape),
    );
  });

  it('answers whether a name is a preview field', () => {
    expect(isPreviewFieldName('title')).toBe(true);
    expect(isPreviewFieldName('image')).toBe(false);
  });
});

describe('PREVIEW_FIELD_STORED_TYPES', () => {
  it('describes the stored shape of every preview field and of nothing else', () => {
    expect(Object.keys(PREVIEW_FIELD_STORED_TYPES)).toEqual([
      ...PREVIEW_FIELD_NAMES,
    ]);
  });

  it('keeps the nested keys aligned with the schemas they describe', () => {
    expect([...PREVIEW_SALARY_KEYS]).toEqual(
      Object.keys(jobPreviewSchema.shape.salary.unwrap().shape),
    );
    expect([...PREVIEW_SKILL_KEYS]).toEqual(
      Object.keys(jobPreviewSchema.shape.skills.element.shape),
    );
    expect([...PREVIEW_LANGUAGE_KEYS]).toEqual(
      Object.keys(jobPreviewSchema.shape.languages.element.shape),
    );
    expect([...PREVIEW_REPLACED_KEYS]).toEqual(['value', 'extractor']);
  });
});

describe('previewSourcesSchema', () => {
  const automatic = {
    value: 'Backend Engineer',
    source: 'auto',
    extractor: 'json-ld',
    at: '2026-09-17T10:00:00.000Z',
  } as const;
  const manual = {
    value: 'Backend Engineer II',
    source: 'manual',
    by: '66e9a0000000000000000002',
    at: '2026-09-18T10:00:00.000Z',
    replaced: { value: 'Backend Engineer', extractor: 'json-ld' },
  } as const;

  it('takes an automatic field with its extractor and a manual one with its author', () => {
    expect(previewSourcesSchema.parse({ title: automatic })).toEqual({
      title: automatic,
    });
    expect(previewSourcesSchema.parse({ title: manual })).toEqual({
      title: manual,
    });
  });

  it('takes a preview with no provenance at all', () => {
    expect(previewSourcesSchema.parse({})).toEqual({});
  });

  it('never mixes the extractor with the author', () => {
    expect(
      previewSourcesSchema.safeParse({
        title: { ...automatic, by: '66e9a0000000000000000002' },
      }).success,
    ).toBe(false);
    expect(
      previewSourcesSchema.safeParse({
        title: {
          value: manual.value,
          source: 'manual',
          extractor: 'json-ld',
          at: manual.at,
        },
      }).success,
    ).toBe(false);
  });

  it('only keeps the displaced value on a manual field', () => {
    expect(
      previewSourcesSchema.safeParse({
        title: { ...automatic, replaced: manual.replaced },
      }).success,
    ).toBe(false);
  });

  it('types the value of each field like the preview does', () => {
    expect(
      previewSourcesSchema.safeParse({
        ...{},
        modality: { ...automatic, value: 'remote' },
      }).success,
    ).toBe(true);
    expect(
      previewSourcesSchema.safeParse({
        modality: { ...automatic, value: 'hibrido' },
      }).success,
    ).toBe(false);
    expect(
      previewSourcesSchema.safeParse({ company: { ...automatic, value: null } })
        .success,
    ).toBe(true);
  });

  it('covers the same fields as the preview, and no unknown one', () => {
    expect(Object.keys(previewSourcesSchema.shape)).toEqual([
      ...PREVIEW_FIELD_NAMES,
    ]);
    expect(previewSourcesSchema.safeParse({ image: automatic }).success).toBe(
      false,
    );
  });

  it('names the keys of an entry for the schemas derived from it', () => {
    expect([...PREVIEW_SOURCE_ENTRY_KEYS].sort()).toEqual(
      [...new Set([...Object.keys(automatic), ...Object.keys(manual)])].sort(),
    );
  });

  it('stores the author as an id and answers with its display name', () => {
    expect(
      previewSourcesSchema.safeParse({
        title: { ...manual, by: { userId: 'u1', displayName: 'Ana' } },
      }).success,
    ).toBe(false);
    expect(
      resolvedPreviewSourcesSchema.parse({
        title: { ...manual, by: { userId: 'u1', displayName: 'Ana' } },
      }),
    ).toEqual({
      title: { ...manual, by: { userId: 'u1', displayName: 'Ana' } },
    });
    expect(
      resolvedPreviewSourcesSchema.safeParse({ title: manual }).success,
    ).toBe(false);
  });
});

describe('updatePreviewRequestSchema', () => {
  it('takes the fields written by hand', () => {
    expect(
      updatePreviewRequestSchema.parse({
        fields: { title: 'Backend Engineer II', company: null },
      }),
    ).toEqual({ fields: { title: 'Backend Engineer II', company: null } });
  });

  it('takes the fields that go back to what was extracted', () => {
    expect(updatePreviewRequestSchema.parse({ revert: ['title'] })).toEqual({
      revert: ['title'],
    });
  });

  it('lets an unknown field through for the domain to name it', () => {
    const parsed = updatePreviewRequestSchema.parse({
      fields: { image: 'https://cdn/x.png' },
      revert: ['image'],
    });

    expect(parsed.fields).toEqual({ image: 'https://cdn/x.png' });
    expect(parsed.revert).toEqual(['image']);
  });

  it('still refuses a known field with the wrong type, naming it', () => {
    expect(
      issuePaths(
        updatePreviewRequestSchema.safeParse({ fields: { title: 7 } }),
      ),
    ).toEqual(['fields.title']);
    expect(
      issuePaths(
        updatePreviewRequestSchema.safeParse({
          fields: { modality: 'hibrido' },
        }),
      ),
    ).toEqual(['fields.modality']);
  });

  it('refuses anything that is not a field or a revert', () => {
    expect(
      updatePreviewRequestSchema.safeParse({
        fields: {},
        previewVersion: 3,
      }).success,
    ).toBe(false);
    expect(
      updatePreviewRequestSchema.safeParse({
        revert: ['a'.repeat(PREVIEW_FIELD_NAME_INPUT_MAX_LENGTH + 1)],
      }).success,
    ).toBe(false);
    expect(
      updatePreviewRequestSchema.safeParse({
        revert: Array.from(
          { length: PREVIEW_FIELD_NAMES.length + 1 },
          () => 'title',
        ),
      }).success,
    ).toBe(false);
  });
});

describe('enrichmentFailureReasonSchema', () => {
  it('lists every closed reason of a failed enrichment', () => {
    expect(enrichmentFailureReasonSchema.options).toEqual([
      'robots_disallowed',
      'blocked',
      'rate_limited',
      'host_busy',
      'not_a_job',
      'not_html',
      'too_large',
      'timeout',
      'http_error',
      'no_data',
      'retries_exhausted',
    ]);
    expect(enrichmentFailureReasonSchema.safeParse('unknown').success).toBe(
      false,
    );
  });

  it('only refuses a retry when reading again would change nothing', () => {
    expect([...NON_RETRYABLE_ENRICHMENT_REASONS]).toEqual([
      'robots_disallowed',
      'blocked',
      'not_a_job',
    ]);
    expect(isRetryableEnrichmentReason('rate_limited')).toBe(true);
    expect(isRetryableEnrichmentReason('host_busy')).toBe(true);
    expect(isRetryableEnrichmentReason('timeout')).toBe(true);
    expect(isRetryableEnrichmentReason('retries_exhausted')).toBe(true);
    expect(isRetryableEnrichmentReason('blocked')).toBe(false);
    expect(isRetryableEnrichmentReason('robots_disallowed')).toBe(false);
    expect(isRetryableEnrichmentReason('not_a_job')).toBe(false);
  });
});

describe('lastEnrichmentErrorSchema', () => {
  it('carries the reason and when it happened, and nothing else', () => {
    const error = {
      reason: 'timeout',
      at: '2026-09-18T10:00:00.000Z',
    } as const;

    expect(lastEnrichmentErrorSchema.parse(error)).toEqual(error);
    expect(
      lastEnrichmentErrorSchema.safeParse({
        ...error,
        status: 503,
      }).success,
    ).toBe(false);
    expect(
      lastEnrichmentErrorSchema.safeParse({ ...error, at: '2026-09-18' })
        .success,
    ).toBe(false);
  });
});
