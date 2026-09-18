import { describe, expect, it } from 'vitest';
import { EMPTY_PAGE_CONTENT, type PageContent } from '../page-content';
import type { ExtractionContext } from './extractor';
import { JsonLdExtractor, findJobPosting } from './json-ld.extractor';

// Requisito "Cadena de extracción lícita" (specs/links/enrichment) y D3 de link-enrichment: la etapa `json-ld`, sin
// HTML ni red. La página real de Trabajopolis, ya parseada, se prueba en `infrastructure/html/real-pages.spec.ts`.

const extractor = new JsonLdExtractor();

function contextOf(page: Partial<PageContent>): ExtractionContext {
  return {
    page: { ...EMPTY_PAGE_CONTENT, ...page },
    createdBy: '68c0f0f0f0f0f0f0f0f0f0f0',
    remainingMs: 30_000,
  };
}

const POSTING = {
  '@context': 'https://schema.org',
  '@type': 'JobPosting',
  title: 'Arquitecto(a) de Soluciones',
  hiringOrganization: { '@type': 'Organization', name: 'Empresa Ejemplo' },
};

describe('La página trae JSON-LD', () => {
  it('takes the preview from the JobPosting the site declares', async () => {
    const { draft, isJobPosting } = await extractor.extract(
      contextOf({ jsonLdBlocks: [POSTING] }),
    );

    expect(draft.title).toEqual({
      value: 'Arquitecto(a) de Soluciones',
      extractor: 'json-ld',
    });
    expect(draft.company).toEqual({
      value: 'Empresa Ejemplo',
      extractor: 'json-ld',
    });
    // Que el sitio publique un `JobPosting` ya dice que la página es una vacante: `not_a_job` queda descartado.
    expect(isJobPosting).toBe(true);
  });

  it('reads the whole posting: place, modality, salary, dates and summary', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [
          {
            ...POSTING,
            description:
              '<p>Buscamos un arquitecto.</p><ul><li>Java &amp; Spring</li></ul>',
            jobLocationType: 'TELECOMMUTE',
            jobLocation: {
              '@type': 'Place',
              address: {
                '@type': 'PostalAddress',
                addressLocality: 'La Paz',
                addressCountry: 'BO',
              },
            },
            baseSalary: {
              '@type': 'MonetaryAmount',
              currency: 'BOB',
              value: {
                '@type': 'QuantitativeValue',
                minValue: 12000,
                maxValue: 18000,
                unitText: 'MONTH',
              },
            },
            datePosted: '2026-09-14T14:37:42-04:00',
            validThrough: '2026-10-14T14:37:42-04:00',
            skills: ['Java', 'Spring Boot'],
          },
        ],
      }),
    );

    expect(draft.location?.value).toBe('La Paz, BO');
    expect(draft.modality?.value).toBe('remote');
    expect(draft.salary?.value).toEqual({
      min: 12000,
      max: 18000,
      currency: 'BOB',
      period: 'month',
    });
    expect(draft.postedAt?.value).toBe('2026-09-14');
    expect(draft.expiresAt?.value).toBe('2026-10-14');
    expect(draft.skills?.value).toEqual([
      { name: 'Java', required: true },
      { name: 'Spring Boot', required: true },
    ]);
    // La descripción llega con marcado dentro: el resumen sale sin etiquetas y con las entidades resueltas.
    expect(draft.summary?.value).toBe('Buscamos un arquitecto. Java & Spring');
  });

  it('reads a fixed salary as its own minimum and maximum', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [
          {
            ...POSTING,
            baseSalary: {
              currency: 'USD',
              value: { value: '3000', unitText: 'MONTH' },
            },
          },
        ],
      }),
    );

    expect(draft.salary?.value).toEqual({
      min: 3000,
      max: 3000,
      currency: 'USD',
      period: 'month',
    });
  });

  it('does not invent a period it cannot translate', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [
          {
            ...POSTING,
            baseSalary: {
              currency: 'USD',
              value: { value: 200, unitText: 'DAY' },
            },
          },
        ],
      }),
    );

    expect(draft.salary?.value).toMatchObject({
      period: null,
      currency: 'USD',
    });
  });

  it('leaves the recruiter contact out of the summary', async () => {
    // Por aquí entraría un correo ajeno en la base de datos si la higiene fuera solo del texto de la página (D7).
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [
          {
            ...POSTING,
            description:
              '<p>Postula a empleos@empresa.example o al 70000000.</p>',
          },
        ],
      }),
    );

    expect(draft.summary?.value).not.toContain('@');
    expect(draft.summary?.value).not.toContain('70000000');
  });

  it('cuts a summary longer than the contract allows', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [{ ...POSTING, description: 'palabra '.repeat(200) }],
      }),
    );

    expect(draft.summary?.value.length).toBeLessThanOrEqual(600);
    expect(draft.summary?.value.endsWith('…')).toBe(true);
  });

  it('does not propose a field the posting does not declare', async () => {
    const { draft } = await extractor.extract(
      contextOf({ jsonLdBlocks: [POSTING] }),
    );

    expect(draft.location).toBeUndefined();
    expect(draft.salary).toBeUndefined();
    expect(draft.summary).toBeUndefined();
  });

  it('drops a field the site publishes broken instead of the whole posting', async () => {
    const { draft } = await extractor.extract(
      contextOf({
        jsonLdBlocks: [{ ...POSTING, datePosted: 'el martes pasado' }],
      }),
    );

    expect(draft.postedAt).toBeUndefined();
    expect(draft.title?.value).toBe('Arquitecto(a) de Soluciones');
  });
});

describe('Dónde vive el JobPosting', () => {
  it('finds it inside an @graph', () => {
    expect(
      findJobPosting([
        {
          '@context': 'https://schema.org',
          '@graph': [{ '@type': 'WebSite' }, POSTING],
        },
      ]),
    ).toBe(POSTING);
  });

  it('finds it inside a list of blocks', () => {
    expect(findJobPosting([[{ '@type': 'BreadcrumbList' }, POSTING]])).toBe(
      POSTING,
    );
  });

  it('finds it when the type comes as a full URL or as a list', () => {
    const asUrl = { '@type': 'http://schema.org/JobPosting', title: 'Uno' };
    const asList = { '@type': ['Thing', 'JobPosting'], title: 'Dos' };

    expect(findJobPosting([asUrl])).toBe(asUrl);
    expect(findJobPosting([asList])).toBe(asList);
  });

  it('does not find one where there is none', async () => {
    expect(
      findJobPosting([{ '@type': 'VideoObject', name: 'Un vídeo' }]),
    ).toBeNull();
    expect(findJobPosting([])).toBeNull();
    expect(findJobPosting([null, 'texto', 42])).toBeNull();

    // Y la etapa no se pronuncia: quien no encuentra nada no dice que la página no sea una vacante.
    const outcome = await extractor.extract(
      contextOf({ jsonLdBlocks: [{ '@type': 'VideoObject' }] }),
    );
    expect(outcome).toEqual({ draft: {} });
  });
});

describe('Cuándo tiene sentido ejecutar la etapa', () => {
  it('only runs on a page that has structured data', () => {
    expect(
      extractor.supports({ ...EMPTY_PAGE_CONTENT, jsonLdBlocks: [POSTING] }),
    ).toBe(true);
    expect(extractor.supports(EMPTY_PAGE_CONTENT)).toBe(false);
  });
});
