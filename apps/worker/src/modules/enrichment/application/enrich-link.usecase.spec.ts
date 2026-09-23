import {
  LINK_ENRICHED_EVENT_TYPE,
  PASTED_PREVIEW_EXTRACTOR,
  type PreviewSources,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { ExtractionChain } from '../domain/extraction-chain';
import type { ExtractorStrategy } from '../domain/extractors/extractor';
import { HeadlessExtractor } from '../domain/extractors/headless.extractor';
import { JsonLdExtractor } from '../domain/extractors/json-ld.extractor';
import { MetadataExtractor } from '../domain/extractors/metadata.extractor';
import { parsePageContent } from '../infrastructure/html/page-content';
import {
  ExtractPreviewService,
  type ExtractPreviewOptions,
} from './extract-preview.service';
import { EnrichLinkUseCase } from './enrich-link.usecase';
import {
  FakeHostMutex,
  FakePageFetcher,
  FakeRobots,
  FixedClock,
  InMemoryEnrichmentNotifier,
  InMemoryLinkRepository,
  InMemorySnapshotStore,
  StubExtractor,
  htmlResponse,
  type StoredLink,
} from './testing/enrichment-test-doubles';
import type { LinkRepository } from './ports/link-repository.port';
import type { PageFetchResult } from './ports/page-fetcher.port';

// Requisitos "Consumo del trabajo encolado", "Estados del enriquecimiento" y "Snapshot de la página"
// (specs/links/enrichment) y D2, D5, D9 y D12 de link-enrichment.

const LINK_ID = '68c0f0f0f0f0f0f0f0f0f0f0';
const ANA = '68c0aaaaaaaaaaaaaaaaaaaa';
const BETO = '68c0bbbbbbbbbbbbbbbbbbbb';
const NOW = new Date('2026-09-18T10:00:00.000Z');
const DEADLINE_MS = 45_000;

const OPTIONS: ExtractPreviewOptions = {
  fetchTimeoutMs: 10_000,
  domainDelayMs: 2_000,
  maxDeferrals: 600,
};

const JOB_POSTING_PAGE = `<html><head><title>Arquitecto | Trabajopolis</title>
<script type="application/ld+json">{"@type":"JobPosting","title":"Arquitecto(a) de Soluciones","hiringOrganization":{"name":"Empresa Ejemplo"}}</script>
</head><body><main>Arquitecto(a) de Soluciones</main></body></html>`;

const OPEN_GRAPH_PAGE = `<html><head>
<meta content="Full-Stack Developer Senior" property="og:title">
<meta content="Trabajo remoto Full time." property="og:description">
</head><body><p>Full-Stack Developer Senior</p></body></html>`;

const VIDEO_PAGE =
  '<html><head><meta property="og:type" content="video"></head><body><p>Un vídeo cualquiera</p></body></html>';

function linkOf(overrides: Partial<StoredLink> = {}): StoredLink {
  return {
    id: LINK_ID,
    displayUrl: 'https://bolsa.example/jobs/1?utm_source=whatsapp',
    originalUrls: ['https://bolsa.example/jobs/1?utm_source=whatsapp'],
    createdBy: ANA,
    previewStatus: 'pending',
    previewVersion: 1,
    preview: {},
    previewSources: {},
    ...overrides,
  };
}

/** El mismo repositorio, pero cuya escritura condicionada nunca gana: es lo que hace otra ejecución más rápida. */
function losingWriter(links: InMemoryLinkRepository): LinkRepository {
  return {
    findById: (linkId) => links.findById(linkId),
    writePreview: () => Promise.resolve(false),
    closeIfOpen: (linkId, write) => links.closeIfOpen(linkId, write),
    touchFreshnessCheck: (linkId, at) => links.touchFreshnessCheck(linkId, at),
    saveSnapshotKey: (linkId, key) => links.saveSnapshotKey(linkId, key),
  };
}

interface Harness {
  useCase: EnrichLinkUseCase;
  links: InMemoryLinkRepository;
  snapshots: InMemorySnapshotStore;
  notifier: InMemoryEnrichmentNotifier;
  mutex: FakeHostMutex;
  clock: FixedClock;
}

function harnessOf({
  link = linkOf(),
  response = htmlResponse(JOB_POSTING_PAGE),
  robots = new FakeRobots(),
  mutex = new FakeHostMutex(),
  snapshots = new InMemorySnapshotStore(),
  extractors,
  writeWins = true,
}: {
  link?: StoredLink | null;
  response?: PageFetchResult;
  robots?: FakeRobots;
  mutex?: FakeHostMutex;
  snapshots?: InMemorySnapshotStore;
  extractors?: readonly ExtractorStrategy[];
  /** `false` finge que otro ganó la escritura condicionada entre la lectura y la escritura. */
  writeWins?: boolean;
} = {}): Harness {
  const links = new InMemoryLinkRepository();
  if (link !== null) links.put(link);
  const repository = writeWins ? links : losingWriter(links);
  const notifier = new InMemoryEnrichmentNotifier();
  const clock = new FixedClock(NOW);
  const chain = new ExtractionChain(
    extractors ?? [
      new JsonLdExtractor(),
      new MetadataExtractor(),
      new HeadlessExtractor(false),
    ],
    () => clock.now().getTime(),
  );
  const extractPreview = new ExtractPreviewService(
    robots,
    mutex,
    new FakePageFetcher(response),
    parsePageContent,
    chain,
    () => clock.now().getTime(),
    OPTIONS,
  );

  return {
    useCase: new EnrichLinkUseCase(
      repository,
      extractPreview,
      snapshots,
      notifier,
      clock,
      DEADLINE_MS,
    ),
    links,
    snapshots,
    notifier,
    mutex,
    clock,
  };
}

describe('Job procesado', () => {
  it('leaves the link with its preview and a status other than pending', async () => {
    const { useCase, links } = harnessOf();

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(result).toEqual({
      kind: 'done',
      previewStatus: 'enriched',
      previewVersion: 2,
    });
    const stored = links.peek(LINK_ID);
    expect(stored?.previewStatus).toBe('enriched');
    expect(stored?.preview.title).toBe('Arquitecto(a) de Soluciones');
    expect(stored?.preview.company).toBe('Empresa Ejemplo');
    const title = stored?.previewSources.title;
    expect(title?.source === 'auto' && title.extractor).toBe('json-ld');
  });

  it('tells the world, with the version it just wrote', async () => {
    const { useCase, notifier } = harnessOf();

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(notifier.published).toEqual([
      {
        type: LINK_ENRICHED_EVENT_TYPE,
        payload: {
          linkId: LINK_ID,
          previewStatus: 'enriched',
          previewVersion: 2,
        },
      },
    ]);
  });
});

describe('El mismo evento dos veces', () => {
  it('leaves the same result and no new version of the preview', async () => {
    const { useCase, links } = harnessOf();
    const job = { linkId: LINK_ID, previewVersion: 1, deferrals: 0 };

    const first = await useCase.execute(job);
    const second = await useCase.execute(job);

    expect(first).toMatchObject({ kind: 'done', previewVersion: 2 });
    // La segunda vuelta trae la versión vieja: se descarta antes de volver a pedirle la página al sitio.
    expect(second).toEqual({ kind: 'skipped', reason: 'stale_version' });
    expect(links.peek(LINK_ID)?.previewVersion).toBe(2);
  });
});

describe('Job de una versión vieja', () => {
  it('completes without touching the link', async () => {
    const { useCase, links } = harnessOf({
      link: linkOf({ previewVersion: 5 }),
    });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 3,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'skipped', reason: 'stale_version' });
    expect(links.writes).toEqual([]);
    expect(links.peek(LINK_ID)?.previewStatus).toBe('pending');
  });
});

describe('Link borrado', () => {
  it('completes without error and without retries', async () => {
    const { useCase, links, notifier } = harnessOf({ link: null });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'skipped', reason: 'link_not_found' });
    expect(links.writes).toEqual([]);
    expect(notifier.published).toEqual([]);
  });
});

describe('Edición durante un enriquecimiento', () => {
  it('keeps what the person wrote and finishes without writing', async () => {
    // El enriquecimiento leyó el link antes de la edición, así que escribe contra una versión que ya no está.
    const { useCase, links, notifier, snapshots } = harnessOf({
      writeWins: false,
    });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'skipped', reason: 'lost_race' });
    expect(links.peek(LINK_ID)?.previewStatus).toBe('pending');
    // La ejecución perdedora no deja objeto ni avisa de un preview que no escribió.
    expect(snapshots.objects.size).toBe(0);
    expect(notifier.published).toEqual([]);
  });

  it('does not overwrite a hand-written field on a later pass', async () => {
    const { useCase, links } = harnessOf({
      link: linkOf({
        previewVersion: 2,
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
    });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 2,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'done', previewStatus: 'manual', previewVersion: 3 });
    expect(links.peek(LINK_ID)?.preview.title).toBe('Lo que escribió Ana');
    // Y los demás campos sí se actualizan.
    expect(links.peek(LINK_ID)?.preview.company).toBe('Empresa Ejemplo');
  });
});

describe('Enriquecido', () => {
  it('Estado tras enriquecer', async () => {
    const { useCase, links } = harnessOf();

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.peek(LINK_ID)?.previewVersion).toBe(2);
  });
});

describe('Parcial', () => {
  it('leaves the link partial with what it did get', async () => {
    const { useCase, links } = harnessOf({
      response: htmlResponse(OPEN_GRAPH_PAGE),
    });

    const result = await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 0,
    });

    expect(result).toMatchObject({ previewStatus: 'partial' });
    expect(links.peek(LINK_ID)?.preview.title).toBe(
      'Full-Stack Developer Senior',
    );
    expect(links.peek(LINK_ID)?.preview.company).toBeUndefined();
  });
});

describe('Fallido', () => {
  it('records the reason of a page that is not there, and not its body', async () => {
    const { useCase, links } = harnessOf({
      response: { ok: false, reason: 'http_error' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('failed');
    expect(links.writes[0].write.lastEnrichmentError).toEqual({
      reason: 'http_error',
      at: NOW.toISOString(),
    });
  });

  it('does not store a snapshot of a page it could not download', async () => {
    const { useCase, snapshots } = harnessOf({
      response: { ok: false, reason: 'timeout' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(snapshots.objects.size).toBe(0);
  });
});

/** Un link que Beto completó pegando el texto de la oferta, con título y empresa. */
const PASTED_SOURCES = {
  title: {
    value: 'Arquitecto de Soluciones',
    source: 'pasted',
    extractor: PASTED_PREVIEW_EXTRACTOR,
    by: BETO,
    at: '2026-09-17T10:00:00.000Z',
  },
  company: {
    value: 'Empresa Ejemplo',
    source: 'pasted',
    extractor: PASTED_PREVIEW_EXTRACTOR,
    by: BETO,
    at: '2026-09-17T10:00:00.000Z',
  },
} as const satisfies PreviewSources;

function pastedLink(overrides: Partial<StoredLink> = {}): StoredLink {
  return linkOf({
    previewStatus: 'enriched',
    preview: { title: 'Arquitecto de Soluciones', company: 'Empresa Ejemplo' },
    previewSources: PASTED_SOURCES,
    ...overrides,
  });
}

describe('Una lectura fallida no borra lo pegado', () => {
  it('Una lectura fallida no borra lo pegado', async () => {
    const { useCase, links } = harnessOf({
      link: pastedLink(),
      response: { ok: false, reason: 'http_error' },
    });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'done', previewStatus: 'enriched', previewVersion: 2 });
    expect(links.peek(LINK_ID)?.preview).toEqual({
      title: 'Arquitecto de Soluciones',
      company: 'Empresa Ejemplo',
    });
    expect(links.peek(LINK_ID)?.previewSources).toEqual(PASTED_SOURCES);
    // El motivo queda registrado igual: es lo que la tarjeta cuenta de la última lectura.
    expect(links.writes[0].write.lastEnrichmentError).toEqual({
      reason: 'http_error',
      at: NOW.toISOString(),
    });
  });

  it('keeps a pasted card readable when robots.txt forbids the page, as happens with LinkedIn', async () => {
    // Completar una tarjeta de LinkedIn pegando y pulsar después reintentar no puede volver a dejarla en "no se pudo
    // leer": el estado sale de los campos que tiene, y el motivo no reintentable se conserva.
    const { useCase, links } = harnessOf({
      link: pastedLink(),
      robots: new FakeRobots({ allowed: false, crawlDelayMs: 0 }),
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'robots_disallowed',
    );
  });

  it('derives partial when what was pasted lacks the company', async () => {
    const { useCase, links } = harnessOf({
      link: pastedLink({
        previewStatus: 'partial',
        preview: { title: 'Arquitecto de Soluciones' },
        previewSources: { title: PASTED_SOURCES.title },
      }),
      response: { ok: false, reason: 'timeout' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('partial');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('timeout');
  });

  it('stays manual when a pasted card also has a hand-written field', async () => {
    const { useCase, links } = harnessOf({
      link: pastedLink({
        previewStatus: 'manual',
        preview: {
          title: 'Arquitecto de Soluciones',
          company: 'Empresa Ejemplo',
          location: 'La Paz',
        },
        previewSources: {
          ...PASTED_SOURCES,
          location: {
            value: 'La Paz',
            source: 'manual',
            by: ANA,
            at: '2026-09-17T11:00:00.000Z',
          },
        },
      }),
      response: { ok: false, reason: 'blocked' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('manual');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('blocked');
  });

  it('keeps what was pasted when the page is read again and says something else', async () => {
    const { useCase, links } = harnessOf({ link: pastedLink() });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewSources).toEqual(PASTED_SOURCES);
    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.writes[0].write.lastEnrichmentError).toBeNull();
  });
});

describe('La bolsa prohíbe la lectura', () => {
  it('uses the reason of a forbidden read, told apart from a page error', async () => {
    const { useCase, links } = harnessOf({
      robots: new FakeRobots({ allowed: false, crawlDelayMs: 0 }),
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'robots_disallowed',
    );
    expect(links.peek(LINK_ID)?.previewStatus).toBe('failed');
  });
});

describe('La bolsa nos bloquea', () => {
  it('uses the blocking reason, told apart from the forbidden read and from an error', async () => {
    const { useCase, links } = harnessOf({
      response: { ok: false, reason: 'blocked' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('blocked');
  });
});

describe('La bolsa pide esperar', () => {
  it('tells a site asking us to come back later from one blocking us', async () => {
    const { useCase, links } = harnessOf({
      response: { ok: false, reason: 'rate_limited' },
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'rate_limited',
    );
  });
});

describe('Lo compartido no era una oferta', () => {
  it('says it does not look like a posting, and stores no title from that page', async () => {
    const ai = new StubExtractor('ai:extract-job', { isJobPosting: false });
    const { useCase, links } = harnessOf({
      response: htmlResponse(VIDEO_PAGE),
      // Sin la etapa de metadatos: lo que importa aquí es que la IA se pronuncie y que no entre ningún campo.
      extractors: [new JsonLdExtractor(), ai, new HeadlessExtractor(false)],
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('failed');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('not_a_job');
    expect(links.peek(LINK_ID)?.preview).toEqual({});
  });
});

describe('Se leyó la página pero no había datos', () => {
  it('uses the missing-data reason, told apart from not being a posting', async () => {
    // Nadie se pronunció: la IA no llegó a responder, así que no se puede decir que no fuera una oferta.
    const ai = new StubExtractor('ai:extract-job');
    const { useCase, links } = harnessOf({
      response: htmlResponse(
        '<html><body><main>Página vacía</main></body></html>',
      ),
      extractors: [new JsonLdExtractor(), ai, new HeadlessExtractor(false)],
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('no_data');
  });

  it('is also the reason when the AI recognises a posting it cannot read', async () => {
    const ai = new StubExtractor('ai:extract-job', { isJobPosting: true });
    const { useCase, links } = harnessOf({
      response: htmlResponse(
        '<html><body><main>Oferta ilegible</main></body></html>',
      ),
      extractors: [new JsonLdExtractor(), ai, new HeadlessExtractor(false)],
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('no_data');
  });
});

describe('Host que nunca se libera', () => {
  it('defers without touching the link', async () => {
    const mutex = new FakeHostMutex();
    mutex.busy.add('bolsa.example');
    const { useCase, links, notifier } = harnessOf({ mutex });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 7,
      }),
    ).toEqual({ kind: 'deferred', deferrals: 8, waitMs: 2_000 });
    expect(links.writes).toEqual([]);
    expect(notifier.published).toEqual([]);
  });

  it('fails with host_busy, never with blocked, once the deferrals run out', async () => {
    const mutex = new FakeHostMutex();
    mutex.busy.add('bolsa.example');
    const { useCase, links } = harnessOf({ mutex });

    await useCase.execute({
      linkId: LINK_ID,
      previewVersion: 1,
      deferrals: 600,
    });

    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe('host_busy');
  });
});

describe('Snapshot guardado', () => {
  it('stores the copy after winning the write, and keeps its key in the link', async () => {
    const { useCase, links, snapshots } = harnessOf();

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect([...snapshots.objects.keys()]).toEqual([`${LINK_ID}/2.html.gz`]);
    expect(links.peek(LINK_ID)?.snapshotKey).toBe(`${LINK_ID}/2.html.gz`);
  });

  it('La copia guardada no se deduce de la versión', async () => {
    // La versión sube también con las ediciones a mano y con los reintentos, que no producen snapshot: aquí el link
    // queda en la versión 3 con la copia de la 2.
    const { useCase, links } = harnessOf();
    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    const enriched = links.peek(LINK_ID);
    links.put({
      ...linkOf({ previewVersion: 3 }),
      snapshotKey: enriched?.snapshotKey,
    });

    expect(links.peek(LINK_ID)?.previewVersion).toBe(3);
    expect(links.peek(LINK_ID)?.snapshotKey).toBe(`${LINK_ID}/2.html.gz`);
  });
});

describe('Almacenamiento caído', () => {
  it('stores the preview anyway and leaves the link without a snapshot key', async () => {
    const { useCase, links } = harnessOf({
      snapshots: new InMemorySnapshotStore(true),
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('enriched');
    expect(links.peek(LINK_ID)?.snapshotKey).toBeUndefined();
  });
});

describe('Otras URLs de la misma vacante', () => {
  it('El historial tiene la misma vacante sin el parámetro prohibido', async () => {
    // El repositorio le da a la cadena el historial del link; la lectura sale de la URL permitida, pero lo que se abre
    // al pulsar la tarjeta sigue siendo la `displayUrl`.
    const forbidden = 'https://bolsa.example/jobs/1?search_id=9';
    const robots = new FakeRobots();
    robots.forbidden.add(forbidden);
    const { useCase, links } = harnessOf({
      link: linkOf({
        displayUrl: forbidden,
        originalUrls: [forbidden, 'https://bolsa.example/jobs/1'],
      }),
      robots,
    });

    expect(
      await useCase.execute({
        linkId: LINK_ID,
        previewVersion: 1,
        deferrals: 0,
      }),
    ).toEqual({ kind: 'done', previewStatus: 'enriched', previewVersion: 2 });
    expect(links.peek(LINK_ID)?.displayUrl).toBe(forbidden);
    expect(links.peek(LINK_ID)?.originalUrls).toEqual([
      forbidden,
      'https://bolsa.example/jobs/1',
    ]);
    expect(links.writes[0].write.lastEnrichmentError).toBeNull();
  });

  it('Todo el historial está prohibido', async () => {
    const { useCase, links } = harnessOf({
      link: linkOf({
        displayUrl: 'https://bolsa.example/jobs/1?search_id=9',
        originalUrls: [
          'https://bolsa.example/jobs/1?search_id=9',
          'https://bolsa.example/jobs/1?search_id=12',
        ],
      }),
      robots: new FakeRobots({ allowed: false, crawlDelayMs: 0 }),
    });

    await useCase.execute({ linkId: LINK_ID, previewVersion: 1, deferrals: 0 });

    expect(links.peek(LINK_ID)?.previewStatus).toBe('failed');
    expect(links.writes[0].write.lastEnrichmentError?.reason).toBe(
      'robots_disallowed',
    );
  });
});
