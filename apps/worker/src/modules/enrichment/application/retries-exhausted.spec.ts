import {
  LINK_ENRICHED_EVENT_TYPE,
  PASTED_PREVIEW_EXTRACTOR,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { ExtractionChain } from '../domain/extraction-chain';
import { EnrichLinkUseCase } from './enrich-link.usecase';
import { ExtractPreviewService } from './extract-preview.service';
import { parsePageContent } from '../infrastructure/html/page-content';
import {
  FakeHostMutex,
  FakePageFetcher,
  FakeRobots,
  FixedClock,
  InMemoryEnrichmentNotifier,
  InMemoryLinkRepository,
  InMemorySnapshotStore,
  htmlResponse,
  type StoredLink,
} from './testing/enrichment-test-doubles';

// Requisito "Estados del enriquecimiento" (specs/links/enrichment), escenario "Job que agota sus reintentos": el link
// deja de estar `pending` y dice por qué, sin quedarse esperando para siempre a un job que ya no volverá.

const LINK_ID = '68c0f0f0f0f0f0f0f0f0f0f0';
const ANA = '68c0aaaaaaaaaaaaaaaaaaaa';
const NOW = new Date('2026-09-18T10:00:00.000Z');

function linkOf(overrides: Partial<StoredLink> = {}): StoredLink {
  return {
    id: LINK_ID,
    displayUrl: 'https://bolsa.example/jobs/1',
    originalUrls: ['https://bolsa.example/jobs/1'],
    createdBy: ANA,
    previewStatus: 'pending',
    previewVersion: 1,
    preview: {},
    previewSources: {},
    ...overrides,
  };
}

function harnessOf(link: StoredLink | null = linkOf()): {
  useCase: EnrichLinkUseCase;
  links: InMemoryLinkRepository;
  notifier: InMemoryEnrichmentNotifier;
} {
  const links = new InMemoryLinkRepository();
  if (link !== null) links.put(link);
  const notifier = new InMemoryEnrichmentNotifier();
  const clock = new FixedClock(NOW);
  const extractPreview = new ExtractPreviewService(
    new FakeRobots(),
    new FakeHostMutex(),
    new FakePageFetcher(htmlResponse('<html></html>')),
    parsePageContent,
    new ExtractionChain([], () => clock.now().getTime()),
    () => clock.now().getTime(),
    { fetchTimeoutMs: 10_000, domainDelayMs: 2_000, maxDeferrals: 600 },
  );

  return {
    useCase: new EnrichLinkUseCase(
      links,
      extractPreview,
      new InMemorySnapshotStore(),
      notifier,
      clock,
      45_000,
    ),
    links,
    notifier,
  };
}

describe('Job que agota sus reintentos', () => {
  it('leaves the link failed with the retries reason, never pending', async () => {
    const { useCase, links } = harnessOf();

    const result = await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(result).toEqual({
      kind: 'done',
      previewStatus: 'failed',
      previewVersion: 2,
    });
    expect(links.peek(LINK_ID)?.previewStatus).toBe('failed');
    expect(links.writes[0].write.lastEnrichmentError).toEqual({
      reason: 'retries_exhausted',
      at: NOW.toISOString(),
    });
  });

  it('tells the world, so an open screen stops saying it is reading', async () => {
    const { useCase, notifier } = harnessOf();

    await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(notifier.published).toEqual([
      {
        type: LINK_ENRICHED_EVENT_TYPE,
        payload: {
          linkId: LINK_ID,
          previewStatus: 'failed',
          previewVersion: 2,
        },
      },
    ]);
  });

  it('keeps the preview it already had and only changes the status', async () => {
    const { useCase, links } = harnessOf(
      linkOf({
        previewStatus: 'partial',
        preview: { title: 'Full-Stack Developer Senior' },
        previewSources: {
          title: {
            value: 'Full-Stack Developer Senior',
            source: 'auto',
            extractor: 'metadata',
            at: NOW.toISOString(),
          },
        },
      }),
    );

    await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(links.peek(LINK_ID)?.preview.title).toBe(
      'Full-Stack Developer Senior',
    );
  });

  it('does not take a hand-corrected link back to failed', async () => {
    const { useCase, links } = harnessOf(
      linkOf({
        previewStatus: 'manual',
        preview: { title: 'Lo que escribió Ana' },
        previewSources: {
          title: {
            value: 'Lo que escribió Ana',
            source: 'manual',
            by: ANA,
            at: NOW.toISOString(),
          },
        },
      }),
    );

    await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    // El estado sigue diciendo que ahí hay algo escrito; el motivo, que la última lectura no llegó.
    expect(links.peek(LINK_ID)?.previewStatus).toBe('manual');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'retries_exhausted',
    );
  });

  it('does not take a pasted link back to failed either', async () => {
    const { useCase, links } = harnessOf(
      linkOf({
        previewStatus: 'enriched',
        preview: { title: 'Arquitecto', company: 'Empresa Ejemplo' },
        previewSources: {
          title: {
            value: 'Arquitecto',
            source: 'pasted',
            extractor: PASTED_PREVIEW_EXTRACTOR,
            by: ANA,
            at: NOW.toISOString(),
          },
          company: {
            value: 'Empresa Ejemplo',
            source: 'pasted',
            extractor: PASTED_PREVIEW_EXTRACTOR,
            by: ANA,
            at: NOW.toISOString(),
          },
        },
      }),
    );

    await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'retries_exhausted',
    );
  });

  it('does not touch a link that moved on, nor one that is gone', async () => {
    const { useCase, links } = harnessOf(linkOf({ previewVersion: 4 }));

    expect(
      await useCase.markRetriesExhausted({
        linkId: LINK_ID,
        previewVersion: 2,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'skipped', reason: 'stale_version' });
    expect(links.writes).toEqual([]);

    expect(
      await harnessOf(null).useCase.markRetriesExhausted({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'skipped', reason: 'link_not_found' });
  });
});

describe('Evento republicado tras la retención', () => {
  it('is discarded by version, without asking the site for the page again', async () => {
    const { useCase, links } = harnessOf();
    // El intento anterior agotó sus reintentos y dejó el link en la versión 2.
    await useCase.markRetriesExhausted({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    // Pasada la retención de la cola, el mismo evento vuelve a entrar con su versión de entonces.
    const republished = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(republished).toEqual({ kind: 'skipped', reason: 'stale_version' });
    expect(links.writes).toHaveLength(1);
    expect(links.peek(LINK_ID)?.previewVersion).toBe(2);
  });
});
