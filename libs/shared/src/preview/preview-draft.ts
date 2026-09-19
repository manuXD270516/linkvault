import type { ZodType } from 'zod';
import {
  PREVIEW_FIELD_NAMES,
  jobPreviewSchema,
  type JobPreview,
  type PreviewFieldName,
  type StoredPreview,
} from '../schemas/preview.schema';

// Lo que una etapa de la cadena propone (D3 y D4 de link-enrichment): campos sueltos, cada uno con el extractor que lo
// produjo. **Sin confianza numérica**: el orden total de la cadena decide los empates, y un número por campo sería un
// invento nuestro que nadie sabría calibrar (desviación de ADR-010 registrada en ADR-022).
//
// Un extractor solo propone lo que de verdad leyó. Lo que no leyó se queda fuera del borrador, y por eso un campo
// ausente nunca borra el que ya había.
//
// Vivía en el dominio del worker; está aquí desde paste-job-description (D3) porque el pegado de `api` necesita el
// mismo filtro de valores vacíos: sin él, un pegado que no trae la empresa la dejaría en blanco para siempre, ya que lo
// automático no puede pisar lo pegado. Lo usan los dos procesos, sin copiarlo.

/** Valor propuesto para un campo, con el extractor del que salió. */
export interface DraftField<Value> {
  readonly value: Value;
  readonly extractor: string;
}

/** Propuesta de una etapa: los campos del preview que consiguió leer, y solo esos. */
export type PreviewDraft = {
  readonly [Field in PreviewFieldName]?: DraftField<JobPreview[Field]>;
};

/** Ninguna propuesta. Lo devuelve la etapa que no encontró nada. */
export const EMPTY_DRAFT: PreviewDraft = {};

/**
 * Un valor que no dice nada no es una propuesta: `undefined` y `null` son "la página no lo pone", `''` y `[]` son lo
 * mismo escrito de otra forma, y `'unknown'` es la manera que tienen `modality` y `seniority` de decirlo dentro de su
 * enum. Proponerlos haría que una etapa fiable tapara con un hueco lo que otra posterior sí sabe.
 */
export function saysSomething(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string')
    return value.trim() !== '' && value !== 'unknown';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/** Schema de cada campo, para juzgar uno a uno lo que propone una etapa. */
const FIELD_SCHEMAS = jobPreviewSchema.shape as Record<string, ZodType>;

/**
 * Borrador de un extractor a partir de lo que consiguió leer, descartando lo que no dice nada y lo que no cumple el
 * contrato de su campo.
 *
 * La validación por campo es lo que permite que un extractor lea datos ajenos —el JSON-LD de un sitio cualquiera, la
 * salida de un modelo— sin poder meter en el link algo que `storedPreviewSchema` rechazaría después. Un campo malo se
 * cae solo: no invalida a los demás, que es lo que pasaría validando el borrador entero de una vez.
 */
export function draftFrom(
  extractor: string,
  fields: Partial<JobPreview>,
): PreviewDraft {
  const draft: Record<string, DraftField<unknown>> = {};
  for (const name of PREVIEW_FIELD_NAMES) {
    const value = fields[name];
    if (saysSomething(value) && FIELD_SCHEMAS[name].safeParse(value).success) {
      draft[name] = { value, extractor };
    }
  }
  // Las claves y los tipos salen de `PREVIEW_FIELD_NAMES` y de `JobPreview`, que es lo que `PreviewDraft` declara; el
  // compilador no puede seguir esa correspondencia a través de un bucle.
  return draft as PreviewDraft;
}

/** Los valores de un borrador, sin su procedencia: es lo que se mira para saber si la pasada ya está completa. */
export function valuesOfDraft(draft: PreviewDraft): StoredPreview {
  const values: Record<string, unknown> = {};
  for (const name of PREVIEW_FIELD_NAMES) {
    const field = draft[name];
    if (field !== undefined) values[name] = field.value;
  }
  return values as StoredPreview;
}

/**
 * Los campos obligatorios (D5): con `title` y `company` el link queda `enriched`, y es también donde la cadena para,
 * porque seguir preguntando ya no cambiaría el resultado.
 */
export function hasRequiredFields(preview: StoredPreview): boolean {
  return saysSomething(preview.title) && saysSomething(preview.company);
}

/** Si la pasada obtuvo algo, sea lo que sea. Sin esto no hay ni `partial`. */
export function hasAnyField(preview: StoredPreview): boolean {
  return PREVIEW_FIELD_NAMES.some((name) => saysSomething(preview[name]));
}
