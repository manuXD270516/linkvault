import {
  jobModalitySchema,
  jobSenioritySchema,
  PREVIEW_FIELD_STORED_TYPES,
  salaryPeriodSchema,
  type PreviewFieldName,
  type PreviewStoredType,
} from '@linkvault/shared';
import { Schema, type SchemaDefinition, type SchemaDefinitionProperty } from 'mongoose';

// Subschemas de `preview` y `previewSources` de `job_links` (D11 de link-enrichment), **derivados** de
// `PREVIEW_FIELD_STORED_TYPES`: la forma se declara una sola vez en `libs/shared` y aquí solo se traduce cada forma a
// lo que Mongoose entiende. El worker tiene su propia traducción de la misma tabla; un test tabular en cada lado
// compara las claves resultantes con las de `libs/shared`, porque dos `strict: true` que se separaran descartarían
// campos en silencio y el preview perdería datos sin que nada fallara.
//
// Los instantes de dentro del preview (`at`) se guardan como **cadena ISO**, no como `Date`: son el payload de un
// contrato que se devuelve tal cual por la API y que escribe el worker, así que guardarlos ya en su forma final quita
// una conversión de en medio en los dos procesos. Las fechas propias del documento (`createdAt`, `previewRequestedAt`)
// sí son `Date`: esas se consultan por rango.

/** Opciones de todo subdocumento del preview: sin `_id` propio y sin descartar los objetos vacíos. */
const subdocumentOptions = {
  _id: false,
  versionKey: false,
  strict: true,
  minimize: false,
} as const;

/** Origen de un campo. `auto` lleva `extractor`; `manual`, `by` y quizá `replaced`. */
const PREVIEW_SOURCE_KINDS = ['auto', 'manual'] as const;

/** Salario publicado: cada parte puede faltar por separado. */
function salaryDefinition(): Schema {
  return new Schema(
    {
      min: { type: Number, required: false },
      max: { type: Number, required: false },
      currency: { type: String, required: false },
      period: {
        type: String,
        required: false,
        enum: [...salaryPeriodSchema.options, null],
      },
    },
    subdocumentOptions,
  );
}

/**
 * Habilidad pedida por la vacante. `required` es un campo del dominio, no la opción de Mongoose.
 *
 * `default: undefined` NO es cosmético: sin él, Mongoose materializa `[]` en todo preview, y un link del que solo se
 * leyó el título saldría por la API diciendo que no pide ninguna habilidad, cuando lo cierto es que no se sabe.
 */
function skillsDefinition(): SchemaDefinitionProperty {
  return {
    type: [
      new Schema(
        {
          name: { type: String, required: true },
          required: { type: Boolean, required: true },
        },
        subdocumentOptions,
      ),
    ],
    default: undefined,
    required: false,
  };
}

/** Idioma pedido por la vacante y el nivel que exige, cuando lo dice. Mismo `default: undefined` que las habilidades. */
function languagesDefinition(): SchemaDefinitionProperty {
  return {
    type: [
      new Schema(
        {
          name: { type: String, required: true },
          level: { type: String, required: false },
        },
        subdocumentOptions,
      ),
    ],
    default: undefined,
    required: false,
  };
}

/**
 * Traducción de cada forma de `libs/shared` a Mongoose. Es un `Record` completo sobre `PreviewStoredType`: una forma
 * nueva en el contrato no compila hasta que se traduce, y lo mismo le pasa al worker con su propia tabla.
 *
 * Devuelve una definición **nueva** en cada llamada: la misma forma se usa en `preview`, en el `value` de su
 * procedencia y en el `replaced` de esta, y compartir la instancia mezclaría sus rutas.
 */
const STORED_TYPE_DEFINITIONS: Readonly<
  Record<PreviewStoredType, () => SchemaDefinitionProperty>
> = {
  string: () => ({ type: String, required: false }),
  // Fecha sin hora (`YYYY-MM-DD`): lo que publica una bolsa es un día, no un instante.
  date: () => ({ type: String, required: false }),
  modality: () => ({
    type: String,
    required: false,
    enum: [...jobModalitySchema.options],
  }),
  seniority: () => ({
    type: String,
    required: false,
    enum: [...jobSenioritySchema.options],
  }),
  salary: () => salaryDefinition(),
  skills: () => skillsDefinition(),
  languages: () => languagesDefinition(),
};

/** Definición del valor guardado de un campo del preview. */
export function previewValueDefinition(
  field: PreviewFieldName,
): SchemaDefinitionProperty {
  return STORED_TYPE_DEFINITIONS[PREVIEW_FIELD_STORED_TYPES[field]]();
}

/**
 * Procedencia de un campo (D4): quién puso ese valor, con qué extractor o a mano, cuándo, y el valor automático que una
 * edición manual desplazó. El valor guardado repite la forma del campo, para que `replaced` pueda devolverse tal cual.
 */
function previewSourceEntry(field: PreviewFieldName): Schema {
  return new Schema(
    {
      value: previewValueDefinition(field),
      source: {
        type: String,
        required: true,
        enum: [...PREVIEW_SOURCE_KINDS],
      },
      extractor: { type: String, required: false },
      by: { type: String, required: false },
      at: { type: String, required: true },
      replaced: {
        type: new Schema(
          {
            value: previewValueDefinition(field),
            extractor: { type: String, required: true },
          },
          subdocumentOptions,
        ),
        required: false,
      },
    },
    subdocumentOptions,
  );
}

/** Una entrada por campo del preview, en el orden de `PREVIEW_FIELD_STORED_TYPES`. */
function definitionPerField(
  definitionOf: (field: PreviewFieldName) => SchemaDefinitionProperty,
): SchemaDefinition {
  const definition: Record<string, SchemaDefinitionProperty> = {};
  for (const field of Object.keys(
    PREVIEW_FIELD_STORED_TYPES,
  ) as PreviewFieldName[]) {
    definition[field] = definitionOf(field);
  }
  return definition;
}

/** Preview guardado: todos los campos opcionales, porque la extracción casi nunca los consigue todos. */
export const previewSubSchema = new Schema(
  definitionPerField(previewValueDefinition),
  subdocumentOptions,
);

/** Procedencia por campo del preview guardado. `by` es el identificador; la API lo resuelve a un nombre visible. */
export const previewSourcesSubSchema = new Schema(
  definitionPerField(previewSourceEntry),
  subdocumentOptions,
);
