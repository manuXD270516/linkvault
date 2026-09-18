import {
  PREVIEW_FIELD_NAMES,
  PREVIEW_LANGUAGE_KEYS,
  PREVIEW_REPLACED_KEYS,
  PREVIEW_SALARY_KEYS,
  PREVIEW_SKILL_KEYS,
  PREVIEW_SOURCE_ENTRY_KEYS,
  jobModalitySchema,
  jobSenioritySchema,
  salaryPeriodSchema,
} from '@linkvault/shared';
import { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { previewSourcesSubSchema, previewSubSchema } from './preview.schemas';

// D11 de link-enrichment: la forma de `preview` y `previewSources` se declara **una sola vez** en `libs/shared` y el
// schema de Mongoose del worker se deriva de ella. Este test tabular es la mitad del contrato —la otra está en
// `api`—: añadir un campo en `libs/shared` y reflejarlo solo en uno de los dos schemas rompe aquí, que es lo que
// impide que dos `strict: true` divergentes descarten campos en silencio.

/** Claves de primer nivel de un subschema, en su orden de declaración. */
function keysOf(schema: Schema): string[] {
  return Object.keys(schema.obj);
}

/** Subschema anidado bajo esa ruta, sea un objeto o una lista. */
function nestedAt(schema: Schema, path: string): Schema {
  const nested = (schema.path(path) as { schema?: Schema }).schema;
  if (nested === undefined) {
    throw new Error(`preview.schemas: ${path} no es un subdocumento`);
  }
  return nested;
}

/** Valores admitidos por una ruta con enum. Las opciones de Mongoose van en una firma de índice. */
function enumOf(schema: Schema, path: string): unknown {
  return (schema.path(path).options as Record<string, unknown>)['enum'];
}

/** Valor por defecto de una ruta, para comprobar que una lista ausente no se inventa vacía. */
function defaultOf(schema: Schema, path: string): unknown {
  return (schema.path(path) as { defaultValue?: unknown }).defaultValue;
}

describe('El preview guardado', () => {
  it('has exactly the fields of the contract, in its order', () => {
    expect(keysOf(previewSubSchema)).toEqual([...PREVIEW_FIELD_NAMES]);
  });

  it('has the shapes the contract declares for what is not a plain string', () => {
    expect(keysOf(nestedAt(previewSubSchema, 'salary'))).toEqual([
      ...PREVIEW_SALARY_KEYS,
    ]);
    expect(keysOf(nestedAt(previewSubSchema, 'skills'))).toEqual([
      ...PREVIEW_SKILL_KEYS,
    ]);
    expect(keysOf(nestedAt(previewSubSchema, 'languages'))).toEqual([
      ...PREVIEW_LANGUAGE_KEYS,
    ]);
  });

  it('accepts exactly the values of each enum of the contract', () => {
    expect(enumOf(previewSubSchema, 'modality')).toEqual([
      ...jobModalitySchema.options,
    ]);
    expect(enumOf(previewSubSchema, 'seniority')).toEqual([
      ...jobSenioritySchema.options,
    ]);
    expect(enumOf(nestedAt(previewSubSchema, 'salary'), 'period')).toEqual([
      ...salaryPeriodSchema.options,
    ]);
  });

  it('does not claim a vacancy asks for no skills when nobody read them', () => {
    // `default: undefined`: la ausencia de un dato se dice con la ausencia del campo, nunca con una lista vacía.
    expect(defaultOf(previewSubSchema, 'skills')).toBeUndefined();
    expect(defaultOf(previewSubSchema, 'languages')).toBeUndefined();
  });
});

describe('La procedencia guardada', () => {
  it('has one entry per field of the contract', () => {
    expect(keysOf(previewSourcesSubSchema)).toEqual([...PREVIEW_FIELD_NAMES]);
  });

  it('has the keys of a provenance entry declared by the contract', () => {
    for (const field of PREVIEW_FIELD_NAMES) {
      expect(keysOf(nestedAt(previewSourcesSubSchema, field))).toEqual([
        ...PREVIEW_SOURCE_ENTRY_KEYS,
      ]);
    }
  });

  it('keeps in `replaced` the automatic value with the same shape as its field', () => {
    const replaced = nestedAt(
      nestedAt(previewSourcesSubSchema, 'salary'),
      'replaced',
    );

    expect(keysOf(replaced)).toEqual([...PREVIEW_REPLACED_KEYS]);
    expect(keysOf(nestedAt(replaced, 'value'))).toEqual([
      ...PREVIEW_SALARY_KEYS,
    ]);
  });

  it('gives each field the shape of its own value, not a generic one', () => {
    expect(
      keysOf(nestedAt(nestedAt(previewSourcesSubSchema, 'skills'), 'value')),
    ).toEqual([...PREVIEW_SKILL_KEYS]);
    expect(
      enumOf(nestedAt(previewSourcesSubSchema, 'modality'), 'value'),
    ).toEqual([...jobModalitySchema.options]);
  });
});
