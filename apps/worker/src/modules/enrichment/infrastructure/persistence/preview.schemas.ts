import {
  PREVIEW_FIELD_STORED_TYPES,
  PREVIEW_SOURCE_KINDS,
  jobModalitySchema,
  jobSenioritySchema,
  salaryPeriodSchema,
  type PreviewFieldName,
  type PreviewStoredType,
} from '@linkvault/shared';
import {
  Schema,
  type SchemaDefinition,
  type SchemaDefinitionProperty,
} from 'mongoose';

// Subschemas de `preview` y `previewSources` para el worker (D11 de link-enrichment), **derivados** de
// `PREVIEW_FIELD_STORED_TYPES`: la forma se declara una sola vez en `libs/shared` y aquí solo se traduce a lo que
// Mongoose entiende. `api` tiene su propia traducción de la misma tabla, y cada lado compara sus claves con las del
// contrato en un test tabular: dos `strict: true` que se separaran descartarían campos en silencio, y el preview
// perdería datos sin que nada fallara.
//
// Los instantes de dentro del preview (`at`) se guardan como **cadena ISO**, no como `Date`: son el payload de un
// contrato que el worker escribe y la API devuelve tal cual.

/** Opciones de todo subdocumento del preview: sin `_id` propio y sin descartar los objetos vacíos. */
const subdocumentOptions = {
  _id: false,
  versionKey: false,
  strict: true,
  minimize: false,
} as const;

function enumOf(options: readonly string[]): SchemaDefinitionProperty {
  return { type: String, required: false, enum: [...options] };
}

/**
 * Lista de subdocumentos con `default: undefined`. Sin eso Mongoose escribiría `skills: []` y `languages: []` en todo
 * preview, y un preview del que no se leyó ninguna habilidad diría que la oferta no pide ninguna, que no es lo mismo
 * que no saberlo: la ausencia de un dato se dice con la ausencia del campo.
 */
function listOf(definition: SchemaDefinition): SchemaDefinitionProperty {
  return {
    type: [new Schema(definition, subdocumentOptions)],
    required: false,
    default: undefined,
  };
}

/**
 * Traducción de cada forma del contrato a Mongoose, completa sobre `PreviewStoredType`: una forma nueva en
 * `libs/shared` no compila aquí hasta que se traduce.
 *
 * Cada entrada devuelve una definición **nueva**: la misma forma se usa en `preview`, en el `value` de su procedencia
 * y en el `replaced` de esa procedencia, y compartir la instancia mezclaría sus rutas.
 */
const STORED_TYPE_DEFINITIONS: Readonly<
  Record<PreviewStoredType, () => SchemaDefinitionProperty>
> = {
  string: () => ({ type: String, required: false }),
  // Fecha sin hora (`YYYY-MM-DD`): lo que publica una bolsa es un día, no un instante.
  date: () => ({ type: String, required: false }),
  modality: () => enumOf(jobModalitySchema.options),
  seniority: () => enumOf(jobSenioritySchema.options),
  salary: () =>
    new Schema(
      {
        min: { type: Number, required: false },
        max: { type: Number, required: false },
        currency: { type: String, required: false },
        period: enumOf(salaryPeriodSchema.options),
      },
      subdocumentOptions,
    ),
  skills: () =>
    listOf({
      name: { type: String, required: true },
      // `required` es el campo del dominio (si la habilidad es obligatoria), no la opción de Mongoose.
      required: { type: Boolean, required: true },
    }),
  languages: () =>
    listOf({
      name: { type: String, required: true },
      level: { type: String, required: false },
    }),
};

/** Definición del valor guardado de un campo del preview. */
export function previewValueDefinition(
  field: PreviewFieldName,
): SchemaDefinitionProperty {
  return STORED_TYPE_DEFINITIONS[PREVIEW_FIELD_STORED_TYPES[field]]();
}

/**
 * Procedencia de un campo: de dónde salió ese valor (`auto`, `pasted` o `manual`, de `PREVIEW_SOURCE_KINDS`), quién lo
 * escribió o lo pegó, cuándo, y la entrada completa que desplazó una persona (D3 de paste-job-description).
 */
function previewSourceEntry(field: PreviewFieldName): Schema {
  return new Schema(
    {
      value: previewValueDefinition(field),
      source: { type: String, required: true, enum: [...PREVIEW_SOURCE_KINDS] },
      extractor: { type: String, required: false },
      by: { type: String, required: false },
      at: { type: String, required: true },
      replaced: {
        type: new Schema(
          {
            value: previewValueDefinition(field),
            // Nada más que `value` es obligatorio: un `replaced` de antes de paste-job-description es
            // `{ value, extractor }`, y `previewSourcesSchema` lo lee como `auto`.
            source: {
              type: String,
              required: false,
              enum: [...PREVIEW_SOURCE_KINDS],
            },
            extractor: { type: String, required: false },
            by: { type: String, required: false },
            at: { type: String, required: false },
          },
          subdocumentOptions,
        ),
        required: false,
      },
    },
    subdocumentOptions,
  );
}

/** Una entrada por campo del preview, en el orden del contrato. */
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

/** Procedencia por campo. `by` se guarda como identificador; es `api` quien lo resuelve a un nombre visible. */
export const previewSourcesSubSchema = new Schema(
  definitionPerField(previewSourceEntry),
  subdocumentOptions,
);
