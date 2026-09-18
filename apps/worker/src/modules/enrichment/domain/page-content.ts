// Lo que el dominio recibe de una página descargada (D3 de link-enrichment). Es **solo el tipo**: el parser vive en
// `infrastructure/html/`, así la cadena de extracción se prueba con objetos literales, sin HTML ni red, y el parser se
// puede cambiar sin tocarla.

export interface PageContent {
  /** `<title>` de la página; `null` cuando no lo hay o está vacío. */
  readonly title: string | null;
  /**
   * Texto legible de la página, ya sin scripts ni estilos y **sin los datos de contacto del aviso** (D7): el email y
   * el teléfono del reclutador son datos de un tercero y no hacen falta para leer una oferta.
   */
  readonly text: string;
  /**
   * Metadatos de la página por su nombre en minúsculas (`og:title`, `description`, `twitter:title`…). El nombre sale
   * de `property`, `name` o `itemprop`, el que traiga la etiqueta: el orden de los atributos en el HTML no importa.
   */
  readonly metaTags: Readonly<Record<string, string>>;
  /**
   * Bloques `application/ld+json` ya parseados, en el orden en que aparecen. Los que no eran JSON válido no están:
   * un bloque roto no es motivo para no leer los demás.
   */
  readonly jsonLdBlocks: readonly unknown[];
}

/** Página sin nada legible. La usan las etapas que no llegan a descargar. */
export const EMPTY_PAGE_CONTENT: PageContent = {
  title: null,
  text: '',
  metaTags: {},
  jsonLdBlocks: [],
};
