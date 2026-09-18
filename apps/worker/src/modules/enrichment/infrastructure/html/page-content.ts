import * as cheerio from 'cheerio/slim';
import { scrubContactDetails } from '../../domain/contact-scrub';
import type { PageContent } from '../../domain/page-content';

// Del HTML descargado al `PageContent` que consume la cadena de extracción (D3 y D7 de link-enrichment).
//
// Se parsea con un parser de verdad y no con expresiones regulares porque el HTML real no coopera: Get on Board
// escribe sus metadatos con `content` **antes** que `property`, que es válido y rompe cualquier regex ingenua, y las
// entidades (`&middot;`, `&amp;`) hay que decodificarlas. Esta es la única razón por la que este archivo existe en
// `infrastructure/`: el dominio recibe datos ya parseados y no conoce a cheerio.

/** Contenedores del cuerpo del aviso, del más específico al más general. */
const MAIN_CONTENT_SELECTORS = ['main', '[role="main"]', 'article', 'body'];

/** Lo que no es texto legible. `noscript` y `template` llevan marcado que la persona nunca ve. */
const NON_CONTENT_SELECTORS =
  'script, style, noscript, template, svg, iframe, object, embed';

/**
 * Elementos tras los que hace falta un separador. `.text()` concatena los nodos de texto tal cual: en un HTML
 * minificado, `<h1>Título</h1><p>Empresa</p>` se leería "TítuloEmpresa" y el modelo vería una palabra inventada.
 */
const BLOCK_SELECTORS =
  'p, div, br, li, tr, td, th, section, article, header, footer, nav, aside, h1, h2, h3, h4, h5, h6, dt, dd, blockquote, pre, option, figcaption';

/** Nombre de un metadato: `property`, `name` o `itemprop`, el que traiga, en minúsculas. */
function metaNameOf(attribs: Record<string, string>): string | null {
  const name = attribs['property'] ?? attribs['name'] ?? attribs['itemprop'];
  return typeof name === 'string' && name.trim() !== ''
    ? name.trim().toLowerCase()
    : null;
}

export function parsePageContent(html: string): PageContent {
  const $ = cheerio.load(html);

  // Los bloques de datos estructurados se leen antes de tirar los `script`: son `script` ellos mismos.
  const jsonLdBlocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).text().trim();
    if (raw === '') return;
    try {
      jsonLdBlocks.push(JSON.parse(raw));
    } catch {
      // Un bloque roto no impide leer los demás: hay sitios que sirven dos y solo uno es válido.
    }
  });

  const metaTags: Record<string, string> = {};
  $('meta').each((_, element) => {
    const name = metaNameOf(element.attribs);
    const content = element.attribs['content'];
    if (name === null || typeof content !== 'string') return;
    const value = content.trim();
    // Gana la primera aparición: los duplicados de una página suelen ser el mismo dato repetido por una plantilla.
    if (value !== '' && metaTags[name] === undefined) metaTags[name] = value;
  });

  const title = $('title').first().text().trim();

  $(NON_CONTENT_SELECTORS).remove();
  $(BLOCK_SELECTORS).after(' ');

  const container = MAIN_CONTENT_SELECTORS.map((selector) =>
    $(selector).first(),
  ).find((found) => found.length > 0);

  return {
    title: title === '' ? null : title,
    text: scrubContactDetails(container?.text() ?? ''),
    metaTags,
    jsonLdBlocks,
  };
}
