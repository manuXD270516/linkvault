import { describe, expect, it } from 'vitest';
import { EMPTY_PAGE_CONTENT, type PageContent } from '../page-content';
import type { ExtractionContext } from './extractor';
import { MetadataExtractor, cleanTitle } from './metadata.extractor';

// Requisito "Cadena de extracción lícita" (specs/links/enrichment) y D3 de link-enrichment: la etapa `metadata`. La
// página real de Get on Board, ya parseada, se prueba en `infrastructure/html/real-pages.spec.ts`.

const extractor = new MetadataExtractor();

function contextOf(page: Partial<PageContent>): ExtractionContext {
  return {
    page: { ...EMPTY_PAGE_CONTENT, ...page },
    createdBy: '68c0f0f0f0f0f0f0f0f0f0f0',
    remainingMs: 30_000,
  };
}

describe('La página solo trae Open Graph', () => {
  it('puts what Open Graph gives in the preview', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        metaTags: {
          'og:title': 'Full-Stack Developer Senior',
          'og:description': 'Trabajo remoto Full time con TypeScript.',
          'og:site_name': 'Get on Board',
        },
      }),
    );

    expect(draft.title).toEqual({
      value: 'Full-Stack Developer Senior',
      extractor: 'metadata',
    });
    expect(draft.summary).toEqual({
      value: 'Trabajo remoto Full time con TypeScript.',
      extractor: 'metadata',
    });
  });

  it('leaves the company for the next stage instead of guessing it', async () => {
    // `og:site_name` es la bolsa, no quien contrata, y partir el título por "at" sería adivinar.
    const { draft, isJobPosting } = await extractor.extract(
      contextOf({
        metaTags: {
          'og:title': 'Full-Stack Developer Senior at Empresa Ejemplo',
          'og:site_name': 'Get on Board',
        },
      }),
    );

    expect(draft.company).toBeUndefined();
    // Y tampoco se pronuncia sobre qué es la página: un vídeo tiene los mismos metadatos que una oferta.
    expect(isJobPosting).toBeUndefined();
  });

  it('does not bring og:image, which this change does not store', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        metaTags: {
          'og:title': 'Full-Stack Developer Senior',
          'og:image': 'https://getonbrd.example/cover.png',
        },
      }),
    );

    expect(Object.keys(draft)).toEqual(['title']);
  });

  it('falls back to twitter: and to plain description', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        metaTags: {
          'twitter:title': 'Arquitecto(a) de Soluciones',
          description: 'Buscamos un arquitecto.',
        },
      }),
    );

    expect(draft.title?.value).toBe('Arquitecto(a) de Soluciones');
    expect(draft.summary?.value).toBe('Buscamos un arquitecto.');
  });

  it('falls back to the page title when there are no metadata', async () => {
    const { draft } = await extractor.extract(
      contextOf({ title: 'Arquitecto(a) de Soluciones' }),
    );

    expect(draft.title?.value).toBe('Arquitecto(a) de Soluciones');
  });

  it('reads the publication date when the page declares it', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        metaTags: {
          'og:title': 'Arquitecto',
          'article:published_time': '2026-09-14T14:37:42-04:00',
          'article:expiration_time': '2026-10-14T00:00:00Z',
        },
      }),
    );

    expect(draft.postedAt?.value).toBe('2026-09-14');
    expect(draft.expiresAt?.value).toBe('2026-10-14');
  });

  it('cleans the description of markup and of contact details', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        metaTags: {
          'og:description':
            '<p>Buscamos un arquitecto &amp; un analista.</p> Escribe a rrhh@empresa.example',
        },
      }),
    );

    expect(draft.summary?.value).toBe(
      'Buscamos un arquitecto & un analista. Escribe a',
    );
  });

  it('proposes nothing from a page without title or metadata', async () => {
    const outcome = await extractor.extract(contextOf({}));

    expect(outcome).toEqual({ draft: {} });
    expect(extractor.supports(EMPTY_PAGE_CONTENT)).toBe(false);
  });
});

describe('El nombre del sitio pegado al título', () => {
  it('is cut when the page says how it is called', () => {
    expect(
      cleanTitle(
        'Full-Stack Developer Senior at Empresa Ejemplo | Get on Board',
        'Get on Board',
      ),
    ).toBe('Full-Stack Developer Senior at Empresa Ejemplo');
    expect(
      cleanTitle('Arquitecto(a) de Soluciones - Trabajopolis', 'Trabajopolis'),
    ).toBe('Arquitecto(a) de Soluciones');
    expect(
      cleanTitle('Get on Board · Full-Stack Developer', 'Get on Board'),
    ).toBe('Full-Stack Developer');
  });

  it('is left alone when the page does not say it', () => {
    // Partir por el primer `|` recortaría un título que lleva uno de verdad.
    expect(cleanTitle('Arquitecto | Soluciones | Trabajopolis', null)).toBe(
      'Arquitecto | Soluciones | Trabajopolis',
    );
  });

  it('does not cut a site name that is part of the job title', () => {
    expect(cleanTitle('Desarrollador para Get on Board', 'Get on Board')).toBe(
      'Desarrollador para Get on Board',
    );
  });
});
