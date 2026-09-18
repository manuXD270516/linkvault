import {
  LINK_CREATED_EVENT_TYPE,
  linkCreatedJobId,
  NON_RETRYABLE_ENRICHMENT_REASONS,
  type EnrichmentFailureReason,
} from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BackfillEnrichment,
  RETRYABLE_ENRICHMENT_REASONS,
} from './backfill-enrichment.usecase';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { jobLinkDraft, objectId } from './testing/link-fixtures';
import { InMemoryOutbox, MovableClock } from './testing/links-test-doubles';

// `api:backfill-enrichment` (tarea 6.10). El comando escribe en el outbox como el alta: ni monta una cola ni mira
// `outbox_events`, así que funciona con el publicador apagado.

const ANA = objectId(1);

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let outbox: InMemoryOutbox;
let backfill: BackfillEnrichment;

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  outbox = new InMemoryOutbox();
  backfill = new BackfillEnrichment(links, outbox, clock);
});

/** Link en `pending` sin evento vivo, como los que dejó un relay caído. */
function pendingLink(slug: string): string {
  return links.seed(
    jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: ANA,
      now: clock.now(),
    }),
  ).id;
}

/** Link `failed` por ese motivo. */
function failedLink(slug: string, reason: EnrichmentFailureReason): string {
  return links.seed({
    ...jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: ANA,
      now: clock.now(),
    }),
    previewStatus: 'failed',
    previewVersion: 2,
    lastEnrichmentError: { reason, at: clock.now().toISOString() },
  }).id;
}

describe('BackfillEnrichment', () => {
  it('Pendientes reencolados', async () => {
    const first = pendingLink('pendiente-1');
    const second = pendingLink('pendiente-2');

    const report = await backfill.execute({ status: 'pending', limit: 500 });

    expect(report).toEqual({ found: 2, requested: 2 });
    expect(outbox.appended.map((event) => event.type)).toEqual([
      LINK_CREATED_EVENT_TYPE,
      LINK_CREATED_EVENT_TYPE,
    ]);
    for (const linkId of [first, second]) {
      const link = await links.findById(linkId);
      expect(link?.previewStatus).toBe('pending');
      expect(link?.previewRequestedAt).toEqual(clock.now());
    }
  });

  it('No se duplica el trabajo que ya está en la cola', async () => {
    const linkId = pendingLink('sin-duplicar');
    const staleJobId = linkCreatedJobId({ linkId, previewVersion: 1 });

    await backfill.execute({ status: 'pending', limit: 500 });
    const payload = outbox.appended[0]?.payload as {
      linkId: string;
      previewVersion: number;
    };

    // La versión sube **siempre**: con la misma, `Queue.add` sobre un job retenido es un no-op y el atasco no se
    // deshace. El trabajo no se duplica porque el consumidor descarta el job viejo al ver que su versión ya pasó; esa
    // otra mitad del escenario vive donde puede comprobarse de verdad, en "Job de una versión vieja" de
    // `apps/worker/src/modules/enrichment/application/enrich-link.usecase.spec.ts`.
    expect(payload.previewVersion).toBe(2);
    expect(linkCreatedJobId(payload)).not.toBe(staleJobId);
    expect(outbox.size).toBe(1);
  });

  it('Publicador apagado', async () => {
    pendingLink('publicador-apagado');

    await backfill.execute({ status: 'pending', limit: 500 });

    // No hay cola en ninguna parte: las peticiones quedan escritas y esperan a que el relay vuelva.
    expect(outbox.size).toBe(1);
    expect(outbox.allWrittenWith).toBeDefined();
  });

  it('Rescate de los transitorios', async () => {
    const rescued = failedLink('tiempo-agotado', 'timeout');
    const refused = failedLink('robots', 'robots_disallowed');
    const blocked = failedLink('bloqueado', 'blocked');
    const notAJob = failedLink('no-es-oferta', 'not_a_job');

    const report = await backfill.execute({ status: 'failed', limit: 500 });

    expect(report).toEqual({ found: 1, requested: 1 });
    expect(outbox.appended[0]?.payload).toMatchObject({ linkId: rescued });
    for (const linkId of [refused, blocked, notAJob]) {
      expect((await links.findById(linkId))?.previewStatus).toBe('failed');
    }
  });

  it('rescues every transient reason and no other', async () => {
    expect([...RETRYABLE_ENRICHMENT_REASONS].sort()).toEqual(
      [
        'host_busy',
        'http_error',
        'no_data',
        'not_html',
        'rate_limited',
        'retries_exhausted',
        'timeout',
        'too_large',
      ].sort(),
    );
    for (const reason of NON_RETRYABLE_ENRICHMENT_REASONS) {
      expect(RETRYABLE_ENRICHMENT_REASONS).not.toContain(reason);
    }
  });

  it('stops at the limit, so the command moves in batches', async () => {
    for (let index = 0; index < 5; index += 1) {
      pendingLink(`tanda-${index}`);
    }

    const report = await backfill.execute({ status: 'pending', limit: 2 });

    expect(report).toEqual({ found: 2, requested: 2 });
    expect(outbox.size).toBe(2);
  });

  it('does not touch links that are already read', async () => {
    links.seed({
      ...jobLinkDraft('https://empresa.example/careers/ya-leida', {
        createdBy: ANA,
        now: clock.now(),
      }),
      previewStatus: 'enriched',
      previewVersion: 2,
    });

    const report = await backfill.execute({ status: 'pending', limit: 500 });

    expect(report).toEqual({ found: 0, requested: 0 });
    expect(outbox.size).toBe(0);
  });
});
