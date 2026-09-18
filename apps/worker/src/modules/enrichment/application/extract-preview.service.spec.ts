import { describe, expect, it } from 'vitest';
import { ExtractionChain } from '../domain/extraction-chain';
import { HeadlessExtractor } from '../domain/extractors/headless.extractor';
import { JsonLdExtractor } from '../domain/extractors/json-ld.extractor';
import { MetadataExtractor } from '../domain/extractors/metadata.extractor';
import { EMPTY_PAGE_CONTENT, type PageContent } from '../domain/page-content';
import {
  ExtractPreviewService,
  type ExtractPreviewOptions,
} from './extract-preview.service';
import {
  FakeHostMutex,
  FakePageFetcher,
  FakeRobots,
  StubExtractor,
  htmlResponse,
} from './testing/enrichment-test-doubles';
import type { ExtractorStrategy } from '../domain/extractors/extractor';

// Requisito "Cadena de extracción lícita" (specs/links/enrichment) y D3 y D7 de link-enrichment: el orden de la
// cadena, la parada temprana, el hueco headless y el reparto del plazo. Sin red, sin Redis y sin IA de verdad.

const LINK = {
  displayUrl: 'https://bolsa.example/jobs/1?utm_source=whatsapp',
  createdBy: '68c0f0f0f0f0f0f0f0f0f0f0',
};

const OPTIONS: ExtractPreviewOptions = {
  fetchTimeoutMs: 10_000,
  domainDelayMs: 2_000,
  maxDeferrals: 600,
};

const JOB_POSTING_PAGE =
  '<html><head><script type="application/ld+json">{"@type":"JobPosting","title":"Arquitecto(a) de Soluciones","hiringOrganization":{"name":"Empresa Ejemplo"}}</script></head><body><main>Arquitecto</main></body></html>';

interface Harness {
  service: ExtractPreviewService;
  robots: FakeRobots;
  mutex: FakeHostMutex;
  fetcher: FakePageFetcher;
  parsed: string[];
  now: () => number;
}

function harnessOf(
  extractors: readonly ExtractorStrategy[],
  {
    robots = new FakeRobots(),
    mutex = new FakeHostMutex(),
    fetcher = new FakePageFetcher(htmlResponse(JOB_POSTING_PAGE)),
    page,
    elapsedPerCall = 0,
  }: {
    robots?: FakeRobots;
    mutex?: FakeHostMutex;
    fetcher?: FakePageFetcher;
    page?: PageContent;
    elapsedPerCall?: number;
  } = {},
): Harness {
  let clock = 0;
  const now = (): number => {
    const current = clock;
    clock += elapsedPerCall;
    return current;
  };
  const parsed: string[] = [];
  const parsePage = (html: string): PageContent => {
    parsed.push(html);
    return page ?? { ...EMPTY_PAGE_CONTENT, text: 'Texto del aviso' };
  };

  return {
    service: new ExtractPreviewService(
      robots,
      mutex,
      fetcher,
      parsePage,
      new ExtractionChain(extractors, now),
      now,
      OPTIONS,
    ),
    robots,
    mutex,
    fetcher,
    parsed,
    now,
  };
}

describe('Se descarga lo que escribió la persona', () => {
  it('requests displayUrl, not the normalized URL', async () => {
    const { service, fetcher, robots } = harnessOf([new MetadataExtractor()]);

    await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 });

    expect(fetcher.requested.map(({ url }) => url)).toEqual([LINK.displayUrl]);
    // Y el permiso se pide para esa misma URL: el `robots.txt` prohíbe rutas, no dominios.
    expect(robots.asked).toEqual([LINK.displayUrl]);
  });

  it('takes the host turn and gives it back with the courtesy wait', async () => {
    const { service, mutex } = harnessOf([new MetadataExtractor()]);

    await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 });

    expect(mutex.acquired).toEqual(['bolsa.example']);
    expect(mutex.released).toEqual([{ host: 'bolsa.example', waitMs: 2_000 }]);
  });

  it('gives the host turn back even when the download fails', async () => {
    const fetcher = new FakePageFetcher({ ok: false, reason: 'http_error' });
    const { service, mutex } = harnessOf([new MetadataExtractor()], {
      fetcher,
    });

    expect(
      await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 }),
    ).toEqual({
      kind: 'failed',
      reason: 'http_error',
    });
    expect(mutex.released).toHaveLength(1);
  });

  it('does not download what the site forbids', async () => {
    const robots = new FakeRobots({ allowed: false, crawlDelayMs: 0 });
    const { service, fetcher, mutex } = harnessOf([new MetadataExtractor()], {
      robots,
    });

    expect(
      await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 }),
    ).toEqual({
      kind: 'failed',
      reason: 'robots_disallowed',
    });
    expect(fetcher.requested).toEqual([]);
    expect(mutex.acquired).toEqual([]);
  });

  it('tampoco descarga una redirección a una ruta prohibida', async () => {
    // El permiso se pidió para la ruta de la oferta; el sitio contesta `302` hacia una que su `robots.txt` niega. Sin
    // volver a preguntar en el salto, una ruta permitida sería la puerta de atrás de cualquier `Disallow` (ADR-003).
    const robots = new FakeRobots();
    robots.forbidden.add('https://bolsa.example/login');
    const fetcher = new FakePageFetcher(htmlResponse(JOB_POSTING_PAGE));
    fetcher.redirectsTo = 'https://bolsa.example/login';
    const { service, mutex } = harnessOf([new MetadataExtractor()], {
      robots,
      fetcher,
    });

    expect(
      await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 }),
    ).toEqual({
      kind: 'failed',
      reason: 'robots_disallowed',
    });
    // Se preguntó por las dos rutas, y de la prohibida no se llegó a pedir nada.
    expect(robots.asked).toEqual([
      LINK.displayUrl,
      'https://bolsa.example/login',
    ]);
    expect(fetcher.requested.map(({ url }) => url)).toEqual([LINK.displayUrl]);
    // Y el turno del host se devuelve igual: el sitio no tiene la culpa de nuestra cortesía.
    expect(mutex.released).toHaveLength(1);
  });

  it('follows a redirect the site does allow', async () => {
    const fetcher = new FakePageFetcher(htmlResponse(JOB_POSTING_PAGE));
    fetcher.redirectsTo = 'https://bolsa.example/jobs/1/es';
    const { service } = harnessOf([new MetadataExtractor()], { fetcher });

    expect(
      await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 }),
    ).toMatchObject({ kind: 'extracted' });
    expect(fetcher.requested.map(({ url }) => url)).toEqual([
      LINK.displayUrl,
      'https://bolsa.example/jobs/1/es',
    ]);
  });

  it('defers instead of waiting when the host is busy', async () => {
    const mutex = new FakeHostMutex();
    mutex.busy.add('bolsa.example');
    const { service, fetcher } = harnessOf([new MetadataExtractor()], {
      mutex,
    });

    expect(
      await service.run({ link: LINK, deferrals: 3, deadlineAt: 45_000 }),
    ).toEqual({
      kind: 'deferred',
      deferrals: 4,
      waitMs: 2_000,
    });
    expect(fetcher.requested).toEqual([]);
  });

  it('gives up with host_busy, never with blocked, once the deferrals run out', async () => {
    const mutex = new FakeHostMutex();
    mutex.busy.add('bolsa.example');
    const { service } = harnessOf([new MetadataExtractor()], { mutex });

    expect(
      await service.run({ link: LINK, deferrals: 600, deadlineAt: 45_000 }),
    ).toEqual({
      kind: 'failed',
      reason: 'host_busy',
    });
  });
});

describe('La página trae JSON-LD', () => {
  it('does not call the AI when JSON-LD was enough', async () => {
    const ai = new StubExtractor('ai:extract-job', {
      fields: { company: 'Otra' },
    });
    const { service, parsed } = harnessOf(
      [
        new JsonLdExtractor(),
        new MetadataExtractor(),
        ai,
        new HeadlessExtractor(false),
      ],
      {
        page: {
          ...EMPTY_PAGE_CONTENT,
          text: 'Arquitecto',
          jsonLdBlocks: [
            {
              '@type': 'JobPosting',
              title: 'Arquitecto(a) de Soluciones',
              hiringOrganization: { name: 'Empresa Ejemplo' },
            },
          ],
        },
      },
    );

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    expect(attempt).toMatchObject({ kind: 'extracted', ran: ['json-ld'] });
    expect(ai.ran).toBe(false);
    expect(parsed).toHaveLength(1);
  });
});

describe('Hace falta la IA', () => {
  it('runs extract-job over the page text when the structured data was not enough', async () => {
    const ai = new StubExtractor('ai:extract-job', {
      fields: { company: 'Empresa Ejemplo', modality: 'remote' },
      isJobPosting: true,
    });
    const { service } = harnessOf(
      [
        new JsonLdExtractor(),
        new MetadataExtractor(),
        ai,
        new HeadlessExtractor(false),
      ],
      {
        page: {
          ...EMPTY_PAGE_CONTENT,
          text: 'Texto del aviso',
          metaTags: { 'og:title': 'Full-Stack Developer Senior' },
        },
      },
    );

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    expect(attempt).toMatchObject({
      kind: 'extracted',
      ran: ['metadata', 'ai:extract-job'],
      isJobPosting: true,
    });
    expect(attempt.kind === 'extracted' && attempt.draft.title?.extractor).toBe(
      'metadata',
    );
    expect(
      attempt.kind === 'extracted' && attempt.draft.company?.extractor,
    ).toBe('ai:extract-job');
  });

  it('runs the AI with who saved the link and with the remaining deadline', async () => {
    const ai = new StubExtractor('ai:extract-job');
    const { service } = harnessOf([ai], { elapsedPerCall: 1_000 });

    await service.run({ link: LINK, deferrals: 0, deadlineAt: 45_000 });

    expect(ai.contexts[0].createdBy).toBe(LINK.createdBy);
    // El plazo que recibe la etapa es lo que queda del del link, no el total.
    expect(ai.contexts[0].remainingMs).toBeLessThan(45_000);
    expect(ai.contexts[0].remainingMs).toBeGreaterThan(0);
  });

  it('keeps what the earlier stages read when a stage breaks', async () => {
    const metadata = new StubExtractor('metadata', {
      fields: { title: 'Arquitecto' },
    });
    const ai = new StubExtractor('ai:extract-job', { fails: true });
    const { service } = harnessOf([metadata, ai]);

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    expect(attempt).toMatchObject({ kind: 'extracted', ran: ['metadata'] });
    expect(attempt.kind === 'extracted' && attempt.draft.title?.value).toBe(
      'Arquitecto',
    );
  });
});

describe('Headless apagado', () => {
  it('does not run any headless stage with the flag off', async () => {
    const headless = new HeadlessExtractor(false);
    const { service } = harnessOf([new MetadataExtractor(), headless]);

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    expect(headless.supports()).toBe(false);
    expect(attempt).toMatchObject({ ran: [] });
  });

  it('is the last link of the chain, after the AI', async () => {
    const ai = new StubExtractor('ai:extract-job');
    const headless = new HeadlessExtractor(true);
    const { service } = harnessOf([ai, headless]);

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    // Encendido, el eslabón existe y no aporta nada: el adaptador de verdad llegará en su propio change.
    expect(attempt).toMatchObject({ ran: ['ai:extract-job', 'headless'] });
    expect(attempt.kind === 'extracted' && attempt.draft).toEqual({});
  });
});

describe('El plazo por link', () => {
  it('does not start a stage once the deadline is spent', async () => {
    const metadata = new StubExtractor('metadata', {
      fields: { title: 'Arquitecto' },
    });
    const ai = new StubExtractor('ai:extract-job');
    // Cada consulta del reloj gasta veinticinco segundos: al llegar a la IA ya no queda plazo.
    const { service } = harnessOf([metadata, ai], { elapsedPerCall: 25_000 });

    const attempt = await service.run({
      link: LINK,
      deferrals: 0,
      deadlineAt: 45_000,
    });

    expect(ai.ran).toBe(false);
    expect(attempt).toMatchObject({ kind: 'extracted', ran: ['metadata'] });
  });

  it('does not even download when the deadline is already spent', async () => {
    const { service, fetcher, mutex } = harnessOf([new MetadataExtractor()]);

    expect(
      await service.run({ link: LINK, deferrals: 0, deadlineAt: -1 }),
    ).toEqual({
      kind: 'failed',
      reason: 'timeout',
    });
    expect(fetcher.requested).toEqual([]);
    // Y el turno se devuelve igualmente: nadie se queda esperando un host que no llegamos a usar.
    expect(mutex.released).toHaveLength(1);
  });

  it('cuts the download timeout to what is left of the link deadline', async () => {
    const { service, fetcher } = harnessOf([new MetadataExtractor()]);

    await service.run({ link: LINK, deferrals: 0, deadlineAt: 3_000 });

    expect(fetcher.requested[0].timeoutMs).toBe(3_000);
  });
});

describe('Una dirección que no es una dirección', () => {
  it('fails without asking anyone', async () => {
    const { service, robots, mutex } = harnessOf([new MetadataExtractor()]);

    expect(
      await service.run({
        link: { ...LINK, displayUrl: 'no es una url' },
        deferrals: 0,
        deadlineAt: 45_000,
      }),
    ).toEqual({ kind: 'failed', reason: 'http_error' });
    expect(robots.asked).toEqual([]);
    expect(mutex.acquired).toEqual([]);
  });
});
