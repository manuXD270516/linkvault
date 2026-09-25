/**
 * Comparación de catálogos XLIFF 1.2 del SPA (spec web/i18n, D3 y D4 de i18n-catalog-gate, ADR-050).
 *
 * Sin dependencias de Node ni del navegador: el `DOMParser` llega inyectado. En los tests es el global de jsdom; en
 * `apps/web/scripts/check-i18n-catalog.ts`, el de `new JSDOM('').window`.
 */

/** Lo único que se usa del `DOMParser`, para aceptar tanto el del navegador como el de jsdom. */
export type XmlParser = Pick<DOMParser, 'parseFromString'>;

/**
 * Resultado de comparar el catálogo recién extraído con el versionado. El veredicto es `equal` (igualdad exacta de
 * texto); las listas solo explican una diferencia. Si las tres están vacías y `unparseable` es falso, las unidades y sus
 * textos coinciden y difieren ubicación, orden o formato.
 */
export type CatalogComparison =
  | { readonly equal: true }
  | {
      readonly equal: false;
      /** Ids que la extracción produce y el catálogo versionado no tiene. */
      readonly added: readonly string[];
      /** Ids del catálogo versionado que la extracción ya no produce. */
      readonly removed: readonly string[];
      /** Ids presentes en ambos cuyo `source` difiere, espacios incluidos. */
      readonly changed: readonly string[];
      /** Alguno de los dos no es XML válido: la diferencia existe, pero no se puede clasificar. */
      readonly unparseable: boolean;
    };

/**
 * Compara el catálogo extraído con el versionado. El veredicto no depende del parseo: un XML roto nunca da `equal`.
 */
export function compareCatalogs(parser: XmlParser, extracted: string, committed: string): CatalogComparison {
  if (extracted === committed) {
    return { equal: true };
  }

  const extractedUnits = sourcesById(parser, extracted);
  const committedUnits = sourcesById(parser, committed);
  if (extractedUnits === null || committedUnits === null) {
    return { equal: false, added: [], removed: [], changed: [], unparseable: true };
  }

  const added = [...extractedUnits.keys()].filter((id) => !committedUnits.has(id));
  const removed = [...committedUnits.keys()].filter((id) => !extractedUnits.has(id));
  const changed = [...extractedUnits].filter(([id, source]) => committedUnits.has(id) && committedUnits.get(id) !== source);

  return {
    equal: false,
    added: added.sort(),
    removed: removed.sort(),
    changed: changed.map(([id]) => id).sort(),
    unparseable: false,
  };
}

/**
 * Ids cuya copia del original en el catálogo inglés ya no coincide con el texto español vigente, sin contar espacios en
 * blanco: su traducción se hizo sobre otro texto. Solo mira las unidades presentes en ambos catálogos (que sean las
 * mismas lo comprueba otra prueba). Lanza si alguno de los dos no es XML válido.
 */
export function staleSources(parser: XmlParser, sourceXliff: string, englishXliff: string): string[] {
  const spanish = sourcesById(parser, sourceXliff);
  const english = sourcesById(parser, englishXliff);
  if (spanish === null || english === null) {
    throw new Error('Invalid XLIFF: cannot compare translation sources');
  }

  return [...english]
    .filter(([id, original]) => spanish.has(id) && collapseWhitespace(spanish.get(id) ?? '') !== collapseWhitespace(original))
    .map(([id]) => id)
    .sort();
}

/** `source` serializado (texto y placeholders) de cada `trans-unit`, por id; `null` si el XML no es válido. */
function sourcesById(parser: XmlParser, xliff: string): Map<string, string> | null {
  const document = parser.parseFromString(xliff, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0) {
    return null;
  }

  const units = new Map<string, string>();
  for (const unit of Array.from(document.getElementsByTagName('trans-unit'))) {
    const source = unit.getElementsByTagName('source')[0];
    units.set(unit.getAttribute('id') ?? '', source?.innerHTML ?? '');
  }
  return units;
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
