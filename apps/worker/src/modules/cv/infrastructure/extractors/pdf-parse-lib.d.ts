// Tipos del **módulo interno** de `pdf-parse` (D9 de cv-upload-extract, ADR-028 "Dependencias").
//
// `@types/pdf-parse` solo declara la raíz del paquete, y la raíz es justo lo que no se puede importar: su `index.js`
// ejecuta un modo de depuración que intenta leer un PDF de ejemplo del propio paquete cuando cree que se le está
// llamando como programa, y en un bundle eso revienta con un `ENOENT` desconcertante. Se importa
// `pdf-parse/lib/pdf-parse.js`, que es la función y nada más.

declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PdfTextItem {
    readonly str: string;
    readonly transform: readonly number[];
  }

  interface PdfPageData {
    getTextContent(options: {
      normalizeWhitespace: boolean;
      disableCombineTextItems: boolean;
    }): Promise<{ readonly items: readonly PdfTextItem[] }>;
  }

  interface PdfParseOptions {
    /** Páginas que se leen; `0` o ausente, todas. */
    readonly max?: number;
    readonly pagerender?: (page: PdfPageData) => Promise<string>;
  }

  interface PdfParseResult {
    readonly numpages: number;
    readonly text: string;
  }

  function pdfParse(
    data: Uint8Array,
    options?: PdfParseOptions,
  ): Promise<PdfParseResult>;

  export = pdfParse;
}
