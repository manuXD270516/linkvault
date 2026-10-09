import { LINK_CREATED_EVENT_TYPE, linkCreatedJobId } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  EnrichmentNotRetryable,
  LinkNotFound,
  TooManyLinkAttempts,
} from '../domain/errors';
import { RequestLinkEnrichment } from './request-link-enrichment.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import {
  enrichedPreview,
  jobLinkDraft,
  objectId,
} from './testing/link-fixtures';
import {
  IN_MEMORY_SESSION,
  InMemoryGroupMembership,
  InMemoryLinkLimiter,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './testing/links-test-doubles';
import type { EnrichmentFailureReason } from '@linkvault/shared';

// `POST /api/links/:id/enrich` (tarea 6.4) con los dobles en memoria. Lo que se comprueba aquí es que la petición viaja
// por el **outbox** y no por una cola, que los motivos que no se pueden reintentar se rechazan y que el límite acota.

const ANA = objectId(1);
const BETO = objectId(2);
const STRANGER = objectId(3);
const BACKEND = objectId(10);
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let userLinks: InMemoryUserLinkRepository;
let outbox: InMemoryOutbox;
let limiter: InMemoryLinkLimiter;
let requestEnrichment: RequestLinkEnrichment;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  userLinks = new InMemoryUserLinkRepository(links);
  outbox = new InMemoryOutbox();
  limiter = new InMemoryLinkLimiter();
  const membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner', 'Backend Bolivia')
    .withMember(BACKEND, BETO);
  requestEnrichment = new RequestLinkEnrichment(
    links,
    groupLinks,
    userLinks,
    membership,
    outbox,
    limiter,
    new InMemoryLinkUserDirectory().set(ANA, 'Ana').set(BETO, 'Beto'),
    clock,
  );
});

/** Link compartido en el grupo que quedó fallido por ese motivo. */
async function failedLink(reason: EnrichmentFailureReason): Promise<string> {
  const link = links.seed({
    ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
    previewStatus: 'failed',
    previewVersion: 2,
    lastEnrichmentError: { reason, at: clock.now().toISOString() },
  });
  await groupLinks.share(
    { groupId: BACKEND, linkId: link.id, sharedBy: ANA, sharedAt: clock.now() },
    IN_MEMORY_SESSION,
  );
  return link.id;
}

describe('RequestLinkEnrichment', () => {
  it('Reintento aceptado', async () => {
    const linkId = await failedLink('timeout');
    clock.advance(60_000);

    const summary = await requestEnrichment.execute(BETO, linkId);

    expect(summary.previewStatus).toBe('pending');
    expect(summary.previewVersion).toBe(3);
    expect(summary.lastEnrichmentError).toBeUndefined();
    expect(summary.previewRequestedAt).toBe(clock.now().toISOString());
    const stored = await links.findById(linkId);
    expect(stored?.lastEnrichmentError).toBeUndefined();
  });

  it('asks for the reading through the outbox, never through a queue', async () => {
    const linkId = await failedLink('http_error');

    await requestEnrichment.execute(BETO, linkId);

    expect(outbox.size).toBe(1);
    expect(outbox.appended[0]).toEqual({
      type: LINK_CREATED_EVENT_TYPE,
      payload: { linkId, previewVersion: 3 },
    });
    expect(outbox.allWrittenWith(IN_MEMORY_SESSION)).toBe(true);
  });

  it('Reintento con trabajo terminal retenido', async () => {
    const linkId = await failedLink('timeout');
    const beforeRetry = linkCreatedJobId({ linkId, previewVersion: 2 });

    await requestEnrichment.execute(ANA, linkId);

    // La versión sube, así que el `jobId` determinista es otro y el job terminal que la cola retiene deja de estorbar.
    const payload = outbox.appended[0]?.payload as {
      linkId: string;
      previewVersion: number;
    };
    expect(linkCreatedJobId(payload)).not.toBe(beforeRetry);
  });

  it.each(['robots_disallowed', 'blocked', 'not_a_job'] as const)(
    'Reintento inútil: %s',
    async (reason) => {
      const linkId = await failedLink(reason);

      await expect(
        requestEnrichment.execute(ANA, linkId),
      ).rejects.toBeInstanceOf(EnrichmentNotRetryable);
      expect(outbox.size).toBe(0);
      // Un 409 no gasta cuota: insistir sobre un link bloqueado no puede dejar sin reintentos a los demás.
      expect(limiter.consumed).toEqual([]);
      expect((await links.findById(linkId))?.previewVersion).toBe(2);
    },
  );

  it('Demasiados reintentos', async () => {
    const linkId = await failedLink('rate_limited');
    limiter.exhaust({ kind: 'enrich-link', linkId });

    await expect(requestEnrichment.execute(ANA, linkId)).rejects.toBeInstanceOf(
      TooManyLinkAttempts,
    );
    expect(outbox.size).toBe(0);
  });

  it('counts the retries of a link, not of the person who asks', async () => {
    const linkId = await failedLink('timeout');

    await requestEnrichment.execute(ANA, linkId);
    await requestEnrichment.execute(BETO, linkId);

    expect(limiter.consumed).toEqual([
      { kind: 'enrich-link', linkId },
      { kind: 'enrich-link', linkId },
    ]);
  });

  it('answers 404 to somebody who cannot see the link', async () => {
    const linkId = await failedLink('timeout');

    await expect(
      requestEnrichment.execute(STRANGER, linkId),
    ).rejects.toBeInstanceOf(LinkNotFound);
    await expect(
      requestEnrichment.execute(ANA, 'no-es-un-id'),
    ).rejects.toBeInstanceOf(LinkNotFound);
    expect(outbox.size).toBe(0);
  });
});

describe('RequestLinkEnrichment provenance names (H1)', () => {
  const CARLA = objectId(4);

  it('response hides authors who share no group with the caller', async () => {
    const link = links.seed({
      ...jobLinkDraft(JOB_PAGE, { createdBy: ANA, now: clock.now() }),
      ...enrichedPreview(ANA),
      previewStatus: 'failed',
      previewVersion: 2,
      lastEnrichmentError: {
        reason: 'timeout',
        at: clock.now().toISOString(),
      },
    });
    await userLinks.save(
      { userId: CARLA, linkId: link.id, savedAt: clock.now() },
      IN_MEMORY_SESSION,
    );
    clock.advance(60_000);

    const summary = await requestEnrichment.execute(CARLA, link.id);
    const company = summary.previewSources?.company;

    expect(company?.source === 'manual' ? company.by : undefined).toBeNull();
    const sources = JSON.stringify(summary.previewSources);
    expect(sources).not.toContain(ANA);
    expect(sources).not.toContain('Ana');
  });
});
