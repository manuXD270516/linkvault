import { describe, expect, it } from 'vitest';
import { GETONBRD_PAGE, TRABAJOPOLIS_PAGE } from './fixtures/page-fixtures';
import { parsePageContent } from './page-content';

// Requisito "Cadena de extracción lícita" (specs/links/enrichment) y D3 y D7 de link-enrichment: del HTML descargado
// al `PageContent` que consume el dominio.

describe('Del HTML al contenido de la página', () => {
  it('takes the body from <main> when the page has one', () => {
    const page = parsePageContent(TRABAJOPOLIS_PAGE);

    expect(page.title).toBe('Arquitecto(a) de Soluciones | Trabajopolis');
    expect(page.text).toContain('Arquitecto(a) de Soluciones');
    expect(page.text).toContain('Empresa Ejemplo');
    // `&middot;` es una entidad: sin decodificar, el modelo vería el nombre de la entidad en vez del separador.
    expect(page.text).toContain('·');
  });

  it('takes the body from <body> when the page has no <main>', () => {
    const page = parsePageContent(GETONBRD_PAGE);

    expect(page.text).toContain('Full-Stack Developer Senior');
    expect(page.text).toContain('Empresa Ejemplo');
  });

  it('prefers <main>, then [role=main], then <article>, then <body>', () => {
    const withArticle = parsePageContent(
      '<body><nav>Menú</nav><article>Cuerpo del aviso</article></body>',
    );
    const withRole = parsePageContent(
      '<body><nav>Menú</nav><div role="main">Cuerpo del aviso</div><article>Otra cosa</article></body>',
    );

    expect(withArticle.text).toBe('Cuerpo del aviso');
    expect(withRole.text).toBe('Cuerpo del aviso');
  });

  it('leaves scripts and styles out of the text', () => {
    const page = parsePageContent(
      '<main><h1>Oferta</h1><script>const secreto = 1;</script><style>.x{color:red}</style><noscript>Activa JavaScript</noscript></main>',
    );

    expect(page.text).toBe('Oferta');
  });

  it('separates block elements, so a minified page does not glue words', () => {
    const page = parsePageContent(
      '<main><h1>Arquitecto</h1><p>Empresa Ejemplo</p><ul><li>Java</li><li>Spring</li></ul></main>',
    );

    expect(page.text).toBe('Arquitecto Empresa Ejemplo Java Spring');
  });

  it('collapses the whitespace of the page', () => {
    const page = parsePageContent(
      '<main>\n\n   Arquitecto\t\tde   Soluciones\n</main>',
    );

    expect(page.text).toBe('Arquitecto de Soluciones');
  });

  it('has no title when the page has none', () => {
    expect(parsePageContent('<html><body>Hola</body></html>').title).toBeNull();
    expect(
      parsePageContent('<html><title>   </title></html>').title,
    ).toBeNull();
  });

  it('survives something that is not a page at all', () => {
    expect(parsePageContent('')).toEqual({
      title: null,
      text: '',
      metaTags: {},
      jsonLdBlocks: [],
    });
  });
});

describe('Metadatos, en cualquier orden de atributos', () => {
  it('reads Open Graph written with content before property', () => {
    // Es el orden real de Get on Board, válido en HTML y suficiente para romper una regex ingenua.
    const page = parsePageContent(GETONBRD_PAGE);

    expect(page.metaTags['og:title']).toBe(
      'Full-Stack Developer Senior at Empresa Ejemplo - Remote (work from home)',
    );
    expect(page.metaTags['og:description']).toContain(
      'Trabajo remoto Full time',
    );
    expect(page.metaTags['og:site_name']).toBe('Get on Board');
    expect(page.metaTags['description']).toBe(
      'Trabajo remoto Full time: Experiencia senior con TypeScript.',
    );
  });

  it('names a metadata by property, name or itemprop, and lowercases it', () => {
    const page = parsePageContent(
      '<head><meta property="OG:Title" content="Por property"><meta name="Description" content="Por name"><meta itemprop="datePosted" content="2026-09-14"></head>',
    );

    expect(page.metaTags).toEqual({
      'og:title': 'Por property',
      description: 'Por name',
      dateposted: '2026-09-14',
    });
  });

  it('keeps the first of two metadata with the same name', () => {
    const page = parsePageContent(
      '<head><meta property="og:title" content="La buena"><meta property="og:title" content="La de la plantilla"></head>',
    );

    expect(page.metaTags['og:title']).toBe('La buena');
  });

  it('ignores metadata without a name or without content', () => {
    const page = parsePageContent(
      '<head><meta charset="utf-8"><meta name="  " content="sin nombre"><meta name="robots"></head>',
    );

    expect(page.metaTags).toEqual({});
  });
});

describe('Datos estructurados', () => {
  it('parses the ld+json blocks of the page, in order', () => {
    const page = parsePageContent(TRABAJOPOLIS_PAGE);

    expect(page.jsonLdBlocks).toHaveLength(1);
    expect(page.jsonLdBlocks[0]).toMatchObject({
      '@type': 'JobPosting',
      title: 'Arquitecto(a) de Soluciones',
      hiringOrganization: { name: 'Empresa Ejemplo' },
    });
  });

  it('has none when the page has none', () => {
    expect(parsePageContent(GETONBRD_PAGE).jsonLdBlocks).toEqual([]);
  });

  it('skips a broken block without losing the good ones', () => {
    const page = parsePageContent(
      '<head><script type="application/ld+json">{ esto no es json </script><script type="application/ld+json">{"@type":"JobPosting"}</script></head>',
    );

    expect(page.jsonLdBlocks).toEqual([{ '@type': 'JobPosting' }]);
  });

  it('keeps the structured data out of the readable text', () => {
    const page = parsePageContent(TRABAJOPOLIS_PAGE);

    expect(page.text).not.toContain('@type');
    expect(page.text).not.toContain('hiringOrganization');
  });
});

describe('Higiene del texto del aviso', () => {
  it('leaves the recruiter email and phone out of the text', () => {
    // El email y el teléfono del aviso son datos de un tercero: ni se guardan ni viajan a un proveedor de IA (D7).
    const page = parsePageContent(TRABAJOPOLIS_PAGE);

    expect(page.text).not.toContain('empleos@empresa.example');
    expect(page.text).not.toContain('70000000');
    expect(page.text).not.toContain('@');
    // Y lo que sí es la oferta sigue ahí.
    expect(page.text).toContain('Arquitecto(a) de Soluciones');
  });

  it('leaves the email of a page without a phone out as well', () => {
    const page = parsePageContent(GETONBRD_PAGE);

    expect(page.text).not.toContain('jobs@empresa.example');
    expect(page.text).toContain('Full-Stack Developer Senior');
  });

  it('leaves mailto: and tel: out of the text', () => {
    const page = parsePageContent(
      '<main><p>Contacto: <a href="mailto:rrhh@empresa.example">rrhh@empresa.example</a> o tel:+59170000000</p></main>',
    );

    expect(page.text).not.toContain('mailto:');
    expect(page.text).not.toContain('tel:');
    expect(page.text).not.toContain('rrhh@empresa.example');
  });

  it('does not mistake a salary for a phone number', () => {
    // El punto es separador de millares en español: aceptarlo como separador de teléfono borraría el salario.
    const page = parsePageContent(
      '<main><p>Salario: 15.000 - 20.000 Bs. Rango anual 20.000.000 COP.</p></main>',
    );

    expect(page.text).toContain('15.000 - 20.000');
    expect(page.text).toContain('20.000.000');
  });
});
