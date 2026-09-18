import { PREVIEW_SUMMARY_MAX_LENGTH } from '@linkvault/shared';

// Recorte de un campo de texto que el sitio rellenó con marcado. **No es un parser de HTML**: el parseo de la página
// vive en `infrastructure/html/` y es el que entrega el `PageContent`. Esto es otra cosa: la `description` de un
// `JobPosting` en JSON-LD y la de un `og:description` vienen a menudo con etiquetas y entidades dentro de un campo que
// el contrato declara como texto, y hay que dejarlas legibles antes de guardarlas como `summary`.

/** Entidades que aparecen de verdad en las descripciones de las bolsas medidas. */
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
  '&nbsp;': ' ',
  '&middot;': '·',
  '&hellip;': '…',
  '&ndash;': '–',
  '&mdash;': '—',
};

/** Texto legible de un campo con marcado: sin etiquetas, con las entidades resueltas y sin espacios de sobra. */
export function toPlainText(value: string): string {
  return (
    value
      // Las etiquetas se sustituyen por un espacio, no por nada: `</p><p>` separa dos frases.
      .replace(/<[^>]*>/g, ' ')
      .replace(
        /&(?:amp|lt|gt|quot|apos|#39|nbsp|middot|hellip|ndash|mdash);/g,
        (entity) => ENTITIES[entity] ?? entity,
      )
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/**
 * Recorte del resumen al máximo del contrato, cortando por la última palabra entera y terminando en `…` para que se
 * vea que sigue. Un corte a mitad de palabra parece un error de la aplicación, no un resumen.
 */
export function truncateSummary(
  value: string,
  maxLength: number = PREVIEW_SUMMARY_MAX_LENGTH,
): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > maxLength / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
