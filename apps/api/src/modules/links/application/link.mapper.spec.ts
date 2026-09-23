import { jobLinkSummarySchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import type { JobLink } from '../domain/job-link';
import {
  displayNameIdsOf,
  toJobLinkSummary,
  UNKNOWN_SHARER_NAME,
} from './link.mapper';
import {
  enrichedPreview,
  jobLinkDraft,
  objectId,
  pastedPreview,
} from './testing/link-fixtures';

// Mapeo de un `JobLink` al contrato de la API. Lo del enriquecimiento se prueba aquí y no por HTTP porque es una función
// pura: los tests de los listados comprueban que llega entera hasta la respuesta.

const CREATED_AT = new Date('2026-09-17T10:00:00.000Z');
const REQUESTED_AT = new Date('2026-09-18T08:30:00.000Z');
const SHARED_AT = new Date('2026-09-18T09:00:00.000Z');

function jobLink(overrides: Partial<JobLink> = {}): JobLink {
  const draft = jobLinkDraft('https://www.linkedin.com/jobs/view/3811111111/', {
    createdBy: objectId(1),
    now: CREATED_AT,
  });
  return { ...draft, id: objectId(7), ...overrides };
}

describe('toJobLinkSummary', () => {
  it('answers when the reading of the offer was asked for', () => {
    const summary = toJobLinkSummary(
      jobLink({ previewRequestedAt: REQUESTED_AT }),
      { sharedAt: SHARED_AT },
    );

    expect(summary.previewRequestedAt).toBe(REQUESTED_AT.toISOString());
    expect(jobLinkSummarySchema.parse(summary)).toEqual(summary);
  });

  it('a link saved before this change falls back to when it was created', () => {
    const { previewRequestedAt, ...legacy } = jobLink();
    expect(previewRequestedAt).toBeDefined();

    const summary = toJobLinkSummary(legacy, { sharedAt: SHARED_AT });

    expect(summary.previewRequestedAt).toBe(CREATED_AT.toISOString());
    expect(jobLinkSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('a new link is born pending with its reading already asked for', () => {
    const summary = toJobLinkSummary(jobLink(), { sharedAt: SHARED_AT });

    expect(summary.previewStatus).toBe('pending');
    expect(summary.previewRequestedAt).toBe(CREATED_AT.toISOString());
  });
});

describe('toJobLinkSummary with a read offer', () => {
  const ANA = objectId(1);
  const enriched = jobLink({
    previewStatus: 'manual',
    previewVersion: 3,
    ...enrichedPreview(ANA),
  });

  it('Oferta enriquecida', () => {
    const summary = toJobLinkSummary(enriched, {
      sharedAt: SHARED_AT,
      names: new Map([[ANA, 'Ana']]),
    });

    expect(jobLinkSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.preview?.title).toBe('Backend Engineer');
    expect(summary.previewVersion).toBe(3);
    expect(summary.previewSources?.title).toEqual({
      value: 'Backend Engineer',
      source: 'auto',
      extractor: 'json-ld',
      at: '2026-09-18T11:00:00.000Z',
    });
  });

  it('says who wrote a field by name, not by identifier', () => {
    const summary = toJobLinkSummary(enriched, {
      sharedAt: SHARED_AT,
      names: new Map([[ANA, 'Ana']]),
    });
    const company = summary.previewSources?.company;

    expect(company?.source).toBe('manual');
    expect(company?.source === 'manual' ? company.by : undefined).toEqual({
      userId: ANA,
      displayName: 'Ana',
    });
    expect(company?.source === 'manual' ? company.replaced : undefined).toEqual(
      { value: 'ACME S.R.L.', source: 'auto', extractor: 'metadata' },
    );
  });

  it('falls back to a neutral name when the directory does not know the author', () => {
    const summary = toJobLinkSummary(enriched, {
      sharedAt: SHARED_AT,
      names: new Map(),
    });
    const company = summary.previewSources?.company;

    expect(
      company?.source === 'manual' ? company.by.displayName : undefined,
    ).toBe(UNKNOWN_SHARER_NAME);
  });

  it('carries the reason of the last failed reading', () => {
    const failed = jobLink({
      previewStatus: 'failed',
      lastEnrichmentError: {
        reason: 'robots_disallowed',
        at: '2026-09-18T11:00:00.000Z',
      },
    });

    const summary = toJobLinkSummary(failed, { sharedAt: SHARED_AT });

    expect(summary.lastEnrichmentError?.reason).toBe('robots_disallowed');
    expect(jobLinkSummarySchema.safeParse(summary).success).toBe(true);
  });

  it('a pending link answers just like before, without preview keys', () => {
    const summary = toJobLinkSummary(jobLink(), { sharedAt: SHARED_AT });

    expect(summary.previewStatus).toBe('pending');
    expect(Object.keys(summary)).not.toContain('preview');
    expect(Object.keys(summary)).not.toContain('previewSources');
    expect(Object.keys(summary)).not.toContain('lastEnrichmentError');
  });

  it('omits group tags and pinned unless the group list context supplies them', () => {
    const privateSummary = toJobLinkSummary(jobLink(), { sharedAt: SHARED_AT });
    expect(privateSummary).not.toHaveProperty('tags');
    expect(privateSummary).not.toHaveProperty('pinned');

    const groupSummary = toJobLinkSummary(jobLink(), {
      sharedAt: SHARED_AT,
      tags: ['remote'],
      pinned: true,
    });
    expect(groupSummary.tags).toEqual(['remote']);
    expect(groupSummary.pinned).toBe(true);
    expect(jobLinkSummarySchema.parse(groupSummary)).toEqual(groupSummary);
  });
});

describe('toJobLinkSummary with a pasted description', () => {
  const ANA = objectId(1);
  const BETO = objectId(2);
  const pasted = jobLink({
    previewStatus: 'manual',
    previewVersion: 4,
    ...pastedPreview(BETO, ANA),
  });
  const summary = toJobLinkSummary(pasted, {
    sharedAt: SHARED_AT,
    names: new Map([
      [ANA, 'Ana'],
      [BETO, 'Beto'],
    ]),
  });

  it('Lo pegado se distingue', () => {
    expect(jobLinkSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.previewSources?.summary).toEqual({
      value: 'Servicios en Node.js para pagos.',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: { userId: BETO, displayName: 'Beto' },
      at: '2026-09-18T11:00:00.000Z',
    });
  });

  it('names the author of what a field keeps to be undone', () => {
    const title = summary.previewSources?.title;

    expect(title?.source === 'manual' ? title.replaced : undefined).toEqual({
      value: 'Backend Engineer',
      source: 'pasted',
      extractor: 'ai:extract-pasted-job',
      by: { userId: BETO, displayName: 'Beto' },
      at: '2026-09-18T11:00:00.000Z',
    });
    // Lo que salió de la página no tiene autor y sale tal cual.
    const company = summary.previewSources?.company;
    expect(company?.source === 'pasted' ? company.replaced : undefined).toEqual(
      {
        value: 'ACME S.R.L.',
        source: 'auto',
        extractor: 'metadata',
        at: '2026-09-18T11:00:00.000Z',
      },
    );
  });
});

describe('displayNameIdsOf', () => {
  const ANA = objectId(1);
  const BETO = objectId(2);

  it('asks once for everyone named in a page, without repeating', () => {
    const links = [
      jobLink({ id: objectId(11), ...enrichedPreview(ANA) }),
      jobLink({ id: objectId(12), ...enrichedPreview(ANA) }),
      jobLink({ id: objectId(13) }),
    ];

    expect(displayNameIdsOf(links, [ANA, BETO, undefined])).toEqual([
      ANA,
      BETO,
    ]);
  });

  it('asks for whoever pasted a field and whoever signed what it keeps to be undone', () => {
    const CARLA = objectId(3);
    const links = [
      jobLink({ id: objectId(11), ...pastedPreview(BETO, ANA) }),
      jobLink({ id: objectId(12), ...pastedPreview(CARLA, ANA) }),
    ];

    expect(displayNameIdsOf(links)).toEqual([ANA, BETO, CARLA]);
  });

  it('asks for nobody when no field was written by hand', () => {
    expect(displayNameIdsOf([jobLink()])).toEqual([]);
  });
});
