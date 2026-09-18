import type { PageContent } from '../../domain/page-content';

// Puerto del parseo del HTML (D3 de link-enrichment). Existe para que `application/` no dependa de `infrastructure/`:
// el parser real vive en `infrastructure/html/` y usa cheerio, y aquí solo se declara la función que entrega el
// `PageContent` que consume la cadena.

export const PAGE_PARSER = Symbol('PAGE_PARSER');

export type PageParser = (html: string) => PageContent;
