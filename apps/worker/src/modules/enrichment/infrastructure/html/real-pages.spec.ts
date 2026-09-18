import { describe, expect, it } from 'vitest';
import type { ExtractionContext } from '../../domain/extractors/extractor';
import { JsonLdExtractor } from '../../domain/extractors/json-ld.extractor';
import { MetadataExtractor } from '../../domain/extractors/metadata.extractor';
import type { PageContent } from '../../domain/page-content';
import { GETONBRD_PAGE, TRABAJOPOLIS_PAGE } from './fixtures/page-fixtures';
import { parsePageContent } from './page-content';

// Requisito "Cadena de extracción lícita" (specs/links/enrichment), de la página real al borrador. Vive en
// `infrastructure/` y no junto a los extractores porque cruza el parser de HTML, que el dominio no puede importar.
//
// Las dos páginas son las únicas de las cinco bolsas del manifiesto que se pueden leer (Context de design.md), y cada
// una demuestra la etapa que la cubre. Entre las dos justifican que no haya adaptadores de selectores por plataforma.

function contextOf(page: PageContent): ExtractionContext {
  return {
    page,
    createdBy: '68c0f0f0f0f0f0f0f0f0f0f0',
    remainingMs: 30_000,
  };
}

describe('La página trae JSON-LD', () => {
  it('reads the real Trabajopolis posting end to end', async () => {
    const page = parsePageContent(TRABAJOPOLIS_PAGE);

    const { draft, isJobPosting } = await new JsonLdExtractor().extract(
      contextOf(page),
    );

    expect(isJobPosting).toBe(true);
    expect(draft.title?.value).toBe('Arquitecto(a) de Soluciones');
    expect(draft.company?.value).toBe('Empresa Ejemplo');
    expect(draft.location?.value).toBe('La Paz, BO');
    expect(draft.postedAt?.value).toBe('2026-09-14');
    expect(draft.expiresAt?.value).toBe('2026-10-14');
    expect(draft.summary?.value).toContain(
      'Empresa Ejemplo busca incorporar a su equipo un arquitecto',
    );
    // Ni en el resumen ni en el texto queda el contacto del reclutador (D7).
    expect(draft.summary?.value).not.toContain('@');
    expect(draft.summary?.value).not.toContain('70000000');
  });
});

describe('La página solo trae Open Graph', () => {
  it('reads the real Get on Board posting and leaves the company for the next stage', async () => {
    const page = parsePageContent(GETONBRD_PAGE);

    expect(page.jsonLdBlocks).toEqual([]);
    const { draft } = await new MetadataExtractor().extract(contextOf(page));

    expect(draft.title?.value).toBe(
      'Full-Stack Developer Senior at Empresa Ejemplo - Remote (work from home)',
    );
    expect(draft.summary?.value).toContain('Trabajo remoto Full time');
    // La cadena tiene que continuar: sin empresa el link no llega a `enriched`.
    expect(draft.company).toBeUndefined();
  });

  it('gives the JSON-LD stage nothing to do', async () => {
    const page = parsePageContent(GETONBRD_PAGE);
    const extractor = new JsonLdExtractor();

    expect(extractor.supports(page)).toBe(false);
    expect(await extractor.extract(contextOf(page))).toEqual({ draft: {} });
  });
});
