import { CV_MIN_TEXT_CHARS, prepareCvText } from '@linkvault/shared';

// De un texto recién extraído al estado que se guarda (D8 de cv-upload-extract, ADR-028 §7). Es dominio puro: aquí no
// hay parser, ni base de datos, ni cola. El extractor entrega una cadena y esta función decide si eso sirve.
//
// La normalización y el tope son los del contrato (`prepareCvText`): un número escrito dos veces acaba diciendo dos
// cosas, y el mínimo que separa "se leyó" de "no hay texto" tiene que ser el mismo que el SPA supone.

export type CvExtractionOutcome =
  /** Hay texto útil: se guarda ya normalizado y, si hacía falta, recortado. */
  | {
      readonly kind: 'extracted';
      readonly text: string;
      readonly chars: number;
      /** Solo para Mongo: no sale en ninguna respuesta. */
      readonly truncated: boolean;
    }
  /**
   * Se abrió, pero no hay texto útil: un PDF escaneado, imágenes. **No es un error del job**: es un resultado, se
   * guarda con su motivo y la persona lo lee en su pantalla con el consejo que corresponde a su formato.
   */
  | { readonly kind: 'no_text' };

/** Decide el desenlace de un texto extraído. Un texto por debajo del mínimo es lo mismo que no tener ninguno. */
export function outcomeOfExtractedText(raw: string): CvExtractionOutcome {
  const prepared = prepareCvText(raw);
  if (prepared.chars < CV_MIN_TEXT_CHARS) {
    return { kind: 'no_text' };
  }
  return {
    kind: 'extracted',
    text: prepared.text,
    chars: prepared.chars,
    truncated: prepared.truncated,
  };
}
