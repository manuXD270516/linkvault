import { draftFrom, scrubContactDetails } from '@linkvault/shared';
import type { PageContent } from '../page-content';
import { toPlainText, truncateSummary } from '../plain-text';
import {
  type ExtractionContext,
  type ExtractionOutcome,
  type ExtractorStrategy,
} from './extractor';

// Segunda etapa de la cadena (D3): los metadatos que la página publica para que la compartan (Open Graph y
// equivalentes) y su `<title>`. Get on Board es el caso que justifica esta etapa: no publica JSON-LD y su Open Graph
// trae título y descripción.
//
// Esta etapa **no propone empresa**, y no es un olvido. Lo que hay en los metadatos es el nombre del sitio
// (`og:site_name`, "Get on Board"), que es la bolsa, no quien contrata; sacar la empresa del título partiéndolo por
// "at" o por "-" sería adivinar. Por eso una página que solo trae Open Graph queda con título y resumen y la cadena
// continúa: la empresa la pone la etapa siguiente.
//
// `og:image` **no entra en este change**: lo pedirá `public-preview-share`, que es donde una imagen remota tiene
// sentido y donde hay que decidir su `referrerpolicy`.

export const METADATA_EXTRACTOR_ID = 'metadata';

/** Separadores con los que un sitio pega su nombre al título de la página. */
const TITLE_SEPARATORS = '|\\u2013\\u2014\\u00b7\\u00bb\\u2022-';

function metaOf(page: PageContent, ...names: readonly string[]): string | null {
  for (const name of names) {
    const value = page.metaTags[name]?.trim();
    if (value !== undefined && value !== '') return value;
  }
  return null;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * El título sin el nombre del sitio pegado detrás o delante. Solo se recorta cuando la página dice cómo se llama
 * (`og:site_name`): sin ese dato, partir por el primer `|` recortaría títulos que llevan uno de verdad.
 */
export function cleanTitle(title: string, siteName: string | null): string {
  if (siteName === null) return title.trim();
  const site = escapeForRegExp(siteName.trim());
  return title
    .replace(new RegExp(`\\s*[${TITLE_SEPARATORS}]\\s*${site}\\s*$`, 'i'), '')
    .replace(new RegExp(`^\\s*${site}\\s*[${TITLE_SEPARATORS}]\\s*`, 'i'), '')
    .trim();
}

/** Día de una fecha ISO con hora, como en `article:published_time`. */
function dateOf(value: string | null): string | null {
  return value === null
    ? null
    : (/^\d{4}-\d{2}-\d{2}/.exec(value)?.[0] ?? null);
}

export class MetadataExtractor implements ExtractorStrategy {
  readonly id = METADATA_EXTRACTOR_ID;

  supports(page: PageContent): boolean {
    return page.title !== null || Object.keys(page.metaTags).length > 0;
  }

  extract({ page }: ExtractionContext): Promise<ExtractionOutcome> {
    const siteName = metaOf(page, 'og:site_name', 'application-name');
    const rawTitle =
      metaOf(page, 'og:title', 'twitter:title') ?? page.title ?? null;
    const title = rawTitle === null ? null : cleanTitle(rawTitle, siteName);

    const rawSummary = metaOf(
      page,
      'og:description',
      'twitter:description',
      'description',
    );
    const summary =
      rawSummary === null
        ? null
        : truncateSummary(scrubContactDetails(toPlainText(rawSummary)));

    return Promise.resolve({
      draft: draftFrom(this.id, {
        title: title ?? undefined,
        summary: summary ?? undefined,
        postedAt:
          dateOf(metaOf(page, 'article:published_time', 'dateposted')) ??
          undefined,
        expiresAt:
          dateOf(metaOf(page, 'article:expiration_time', 'validthrough')) ??
          undefined,
      }),
      // Los metadatos no dicen qué es la página: un vídeo y una oferta tienen los mismos.
    });
  }
}
