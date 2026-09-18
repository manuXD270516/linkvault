import {
  PREVIEW_FIELD_NAMES,
  PREVIEW_FIELD_STORED_TYPES,
  PREVIEW_LANGUAGE_KEYS,
  PREVIEW_REPLACED_KEYS,
  PREVIEW_SALARY_KEYS,
  PREVIEW_SKILL_KEYS,
  PREVIEW_SOURCE_ENTRY_KEYS,
} from '@linkvault/shared';
import type { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { jobLinkSchema } from './link.schemas';
import { previewSourcesSubSchema, previewSubSchema } from './preview.schemas';

// Test tabular de la tarea 5.1: las claves de los subschemas de Mongoose salen de `libs/shared` y de ningún otro sitio.
// El worker tiene el suyo sobre la misma tabla; si un campo se añade en `libs/shared` y solo se refleja en uno de los
// dos, el test del otro falla. No hace falta Mongo: todo se lee del schema.

/** Rutas declaradas de un subschema, en orden de declaración. */
function pathsOf(schema: Schema): string[] {
  return Object.keys(schema.paths);
}

/** Subschema de una ruta anidada (subdocumento o array de subdocumentos). */
function nestedSchema(schema: Schema, path: string): Schema {
  const nested = schema.path(path).schema;
  if (nested === undefined) {
    throw new Error(`Path ${path} is not a nested schema`);
  }
  return nested;
}

describe('preview subschema', () => {
  it('declares exactly the fields of the shared contract', () => {
    expect(pathsOf(previewSubSchema)).toEqual([...PREVIEW_FIELD_NAMES]);
  });

  it('is the one that job_links stores under preview', () => {
    expect(nestedSchema(jobLinkSchema, 'preview')).toBe(previewSubSchema);
    expect(nestedSchema(jobLinkSchema, 'previewSources')).toBe(
      previewSourcesSubSchema,
    );
  });

  it.each([
    ['salary', PREVIEW_SALARY_KEYS],
    ['skills', PREVIEW_SKILL_KEYS],
    ['languages', PREVIEW_LANGUAGE_KEYS],
  ])('declares the nested keys of %s', (field, keys) => {
    expect(pathsOf(nestedSchema(previewSubSchema, field))).toEqual([...keys]);
  });
});

describe('previewSources subschema', () => {
  it('declares exactly one provenance entry per preview field', () => {
    expect(pathsOf(previewSourcesSubSchema)).toEqual([...PREVIEW_FIELD_NAMES]);
  });

  it.each([...PREVIEW_FIELD_NAMES])(
    'declares the provenance keys of %s',
    (field) => {
      expect(pathsOf(nestedSchema(previewSourcesSubSchema, field))).toEqual([
        ...PREVIEW_SOURCE_ENTRY_KEYS,
      ]);
    },
  );

  it.each([...PREVIEW_FIELD_NAMES])(
    'stores the displaced automatic value of %s with the same shape as the field',
    (field) => {
      const entry = nestedSchema(previewSourcesSubSchema, field);
      const replaced = nestedSchema(entry, 'replaced');

      expect(pathsOf(replaced)).toEqual([...PREVIEW_REPLACED_KEYS]);
      expect(entry.path('value').instance).toBe(
        replaced.path('value').instance,
      );
    },
  );

  it('keeps the stored shape of every field, not a free form blob', () => {
    for (const field of PREVIEW_FIELD_NAMES) {
      const value = nestedSchema(previewSourcesSubSchema, field).path('value');

      expect(value.instance).not.toBe('Mixed');
      expect(value.instance).toBe(previewSubSchema.path(field).instance);
    }
  });

  it('covers every stored type of the shared table', () => {
    expect(new Set(Object.values(PREVIEW_FIELD_STORED_TYPES)).size).toBe(7);
  });
});
