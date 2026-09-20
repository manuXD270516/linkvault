import type { PublicJobPreview } from '@linkvault/shared';
import { escapeHtml } from './escape';
import { ogDescription, ogTitle, salaryText } from './og-tags';

// Plantilla de la página pública (D4 y D5 de public-preview-share, ADR-027 §4). Una **función pura** que devuelve una
// cadena: sin motor de plantillas y sin estáticos, porque el contenido es dinámico y una dependencia más por una página
// no se paga.
//
// **Sin JavaScript.** El salto al SPA va solo con `<meta http-equiv="refresh" content="0; …">` más un enlace visible de
// respaldo. Un `<script>` obligaría a `script-src 'unsafe-inline'` —justo la directiva que queremos en `'none'`— y a
// serializar una URL dentro de un bloque de JavaScript, con su propia superficie de `</script>`. Los bots no siguen el
// `refresh`: leen las etiquetas del `<head>`, que van antes del `<body>` y no dependen de nada.
//
// **Todo valor pasa por `escapeHtml`**, esté en un texto o en un atributo. La URL de la oferta original llega ya
// saneada por `publicHttpUrl` (D6), así que aquí no hay ninguna decisión sobre esquemas.
//
// Español fijo: el contenido es el preview, que se extrae siempre en español (ADR-023 §1), y el texto propio son tres
// frases. Negociar por `Accept-Language` obligaría a `Vary` y a traducir un HTML que nadie mantiene.

/** Textos de la página. Se comprueban literalmente en su test: NO se marcan para i18n (D12). */
export const PUBLIC_PAGE_TEXTS = {
  siteName: 'LinkVault',
  cta: 'Guardar en LinkVault',
  ctaPitch:
    'Guarda aquí las ofertas que te pasan por WhatsApp y no las pierdas.',
  original: 'Ver la oferta original',
  fallbackLink: 'Ver la oferta en LinkVault',
  goneTitle: 'Este enlace ya no está disponible',
  goneHint: 'Pídeselo de nuevo a quien te lo envió',
  goneLink: 'Ir a LinkVault',
  tooManyTitle: 'Demasiadas peticiones. Inténtalo en un momento.',
} as const;

/** Medidas de la imagen de marca, fija para todas las ofertas (D5). */
const OG_IMAGE = { path: '/assets/og-default.png', width: 1200, height: 630 };

/** CSS mínimo en línea: ni fuentes, ni scripts externos, ni analítica. Es el único hueco de la CSP. */
const STYLE = [
  'body{margin:0;padding:2rem 1.25rem;font:16px/1.5 system-ui,sans-serif;color:#1c1b1f;background:#fdfcff}',
  'main{max-width:34rem;margin:0 auto}',
  'h1{font-size:1.5rem;margin:0 0 .5rem}',
  'dl{display:grid;grid-template-columns:auto 1fr;gap:.25rem .75rem;margin:1rem 0}',
  'dt{color:#49454f}',
  'dd{margin:0}',
  'p{margin:.5rem 0}',
  'a{color:#3d5bc3}',
].join('');

/** Lo único que necesitan las páginas de error: adónde mandar a quien llega. */
export interface PublicPageBrand {
  /** Origen del SPA. Sin barra final. */
  readonly webBaseUrl: string;
}

/** Orígenes públicos que la plantilla necesita; llegan de configuración, nunca de la cabecera `Host`. */
export interface PublicPageUrls extends PublicPageBrand {
  /** URL absoluta de esta misma página: es lo que va en `og:url`. */
  readonly pageUrl: string;
  /** URL absoluta de la vista pública del SPA: adonde salta el navegador. */
  readonly webUrl: string;
}

/** HTML de una oferta publicada (`200`), con sus etiquetas Open Graph y el salto al SPA. */
export function publicPageHtml(
  preview: PublicJobPreview,
  urls: PublicPageUrls,
): string {
  const title = ogTitle(preview);
  const description = ogDescription(preview);
  return document({
    title,
    head: [
      ogTags(title, description, urls),
      `<meta http-equiv="refresh" content="0; url=${escapeHtml(urls.webUrl)}">`,
    ].join(''),
    body: [
      `<h1>${escapeHtml(title)}</h1>`,
      fields(preview),
      originalLink(preview),
      `<p>${escapeHtml(PUBLIC_PAGE_TEXTS.cta)}</p>`,
      `<p>${escapeHtml(PUBLIC_PAGE_TEXTS.ctaPitch)}</p>`,
      `<p><a href="${escapeHtml(urls.webUrl)}">${escapeHtml(PUBLIC_PAGE_TEXTS.fallbackLink)}</a></p>`,
    ].join(''),
  });
}

/**
 * HTML de un enlace inexistente, quemado o mal formado (`404`). **Sin etiquetas Open Graph y sin redirect**: no hay
 * oferta que enseñar y no hay adónde llevar a nadie. El cuerpo es idéntico en los cinco casos, así que quien prueba
 * slugs no aprende nada.
 */
export function publicPageGoneHtml(urls: PublicPageBrand): string {
  return document({
    title: PUBLIC_PAGE_TEXTS.goneTitle,
    head: '',
    body: [
      `<h1>${escapeHtml(PUBLIC_PAGE_TEXTS.goneTitle)}</h1>`,
      `<p>${escapeHtml(PUBLIC_PAGE_TEXTS.goneHint)}</p>`,
      `<p><a href="${escapeHtml(urls.webBaseUrl)}">${escapeHtml(PUBLIC_PAGE_TEXTS.goneLink)}</a></p>`,
    ].join(''),
  });
}

/** HTML de una petición que superó el límite (`429`). La regla de "esta ruta nunca devuelve JSON" vale también aquí. */
export function publicPageTooManyHtml(urls: PublicPageBrand): string {
  return document({
    title: PUBLIC_PAGE_TEXTS.tooManyTitle,
    head: '',
    body: [
      `<h1>${escapeHtml(PUBLIC_PAGE_TEXTS.tooManyTitle)}</h1>`,
      `<p><a href="${escapeHtml(urls.webBaseUrl)}">${escapeHtml(PUBLIC_PAGE_TEXTS.goneLink)}</a></p>`,
    ].join(''),
  });
}

/**
 * Esqueleto común de las tres respuestas: `lang="es"`, `noindex` —la oferta es de la bolsa que la publicó y LinkVault
 * no la duplica en los buscadores— y el CSS mínimo. Menos de 4 kB.
 */
function document(parts: {
  title: string;
  head: string;
  body: string;
}): string {
  return [
    '<!doctype html>',
    '<html lang="es">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(parts.title)}</title>`,
    parts.head,
    `<style>${STYLE}</style>`,
    '</head>',
    `<body><main>${parts.body}</main></body>`,
    '</html>',
  ].join('');
}

/** Etiquetas Open Graph y Twitter, en el orden de D5 y todas escapadas. `og:url` sale de configuración. */
function ogTags(
  title: string,
  description: string,
  urls: PublicPageUrls,
): string {
  const image = `${urls.webBaseUrl}${OG_IMAGE.path}`;
  return [
    meta('og:site_name', PUBLIC_PAGE_TEXTS.siteName),
    meta('og:type', 'website'),
    meta('og:locale', 'es_ES'),
    meta('og:url', urls.pageUrl),
    meta('og:title', title),
    meta('og:description', description),
    meta('og:image', image),
    meta('og:image:width', String(OG_IMAGE.width)),
    meta('og:image:height', String(OG_IMAGE.height)),
    meta('og:image:alt', PUBLIC_PAGE_TEXTS.siteName),
    meta('twitter:card', 'summary_large_image'),
    meta('twitter:title', title),
    meta('twitter:description', description),
    meta('twitter:image', image),
  ].join('');
}

function meta(property: string, content: string): string {
  return `<meta property="${escapeHtml(property)}" content="${escapeHtml(content)}">`;
}

/** Los campos de la oferta que existan, con su etiqueta. Lo que no llega no se pinta: la plantilla no puede inventarlo. */
function fields(preview: PublicJobPreview): string {
  const rows: [string, string][] = [];
  push(rows, 'Empresa', preview.company);
  push(rows, 'Ubicación', preview.location);
  push(rows, 'Salario', salaryText(preview.salary));
  push(rows, 'Modalidad', MODALITIES[preview.modality ?? 'unknown']);
  push(rows, 'Nivel', SENIORITIES[preview.seniority ?? 'unknown']);
  push(rows, 'Publicada el', preview.postedAt);
  push(rows, 'Cierra el', preview.expiresAt);
  if (rows.length === 0) {
    return '';
  }
  const items = rows
    .map(
      ([label, value]) =>
        `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`,
    )
    .join('');
  return `<dl>${items}</dl>`;
}

function push(
  rows: [string, string][],
  label: string,
  value: string | undefined,
): void {
  if (value !== undefined && value.length > 0) {
    rows.push([label, value]);
  }
}

const MODALITIES: Readonly<Record<string, string | undefined>> = {
  remote: 'Remoto',
  hybrid: 'Híbrido',
  onsite: 'Presencial',
  unknown: undefined,
};

const SENIORITIES: Readonly<Record<string, string | undefined>> = {
  intern: 'Prácticas',
  junior: 'Junior',
  mid: 'Intermedio',
  senior: 'Senior',
  lead: 'Líder',
  unknown: undefined,
};

/** Enlace a la oferta original; se omite si `publicHttpUrl` no dejó ninguna URL publicable (D6). */
function originalLink(preview: PublicJobPreview): string {
  const url = preview.displayUrl;
  if (url === undefined) {
    return '';
  }
  return `<p><a href="${escapeHtml(url)}" rel="noopener noreferrer nofollow">${escapeHtml(PUBLIC_PAGE_TEXTS.original)}</a></p>`;
}
