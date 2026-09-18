import { PREVIEW_FIELD_NAMES, PREVIEW_FIELD_STORED_TYPES, PREVIEW_LANGUAGE_KEYS, PREVIEW_REPLACED_KEYS, PREVIEW_SALARY_KEYS, PREVIEW_SKILL_KEYS, PREVIEW_SOURCE_ENTRY_KEYS, PREVIEW_SOURCE_KINDS } from '@linkvault/shared';
import { JOB_LINK_SCHEMA_OPTIONS, LAST_ENRICHMENT_ERROR_SCHEMA_OPTIONS } from '@linkvault/testing';
import type { Schema } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { jobLinkSchema } from './link.schemas';
import { previewSourcesSubSchema, previewSubSchema } from './preview.schemas';

// Test tabular de la tarea 5.1: las claves de los subschemas de Mongoose **y las opciones con las que se declara
// `job_links`** salen de `libs/shared` y de ningún otro sitio. El worker tiene el suyo sobre las mismas tablas; si un
// campo se añade en `libs/shared` y solo se refleja en uno de los dos, o si un `minimize` cambia solo a un lado, el
// test del otro falla. No hace falta Mongo: todo se lee del schema.

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

/** Las opciones que declara el schema, acotadas a las de la tabla: Mongoose rellena muchas más por su cuenta. */
function declaredOptions(
  schema: Schema,
  expected: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const options = schema.options as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(expected).map((key) => [key, options[key]]),
  );
}

describe('opciones de job_links', () => {
  it('declares the same schema options as the worker view of the collection', () => {
    expect(declaredOptions(jobLinkSchema, JOB_LINK_SCHEMA_OPTIONS)).toEqual(
      JOB_LINK_SCHEMA_OPTIONS,
    );
  });

  it('declares the same options for lastEnrichmentError as the worker does', () => {
    expect(
      declaredOptions(
        nestedSchema(jobLinkSchema, 'lastEnrichmentError'),
        LAST_ENRICHMENT_ERROR_SCHEMA_OPTIONS,
      ),
    ).toEqual(LAST_ENRICHMENT_ERROR_SCHEMA_OPTIONS);
  });
});

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
    'admits every source of the contract in %s and in what it displaced',
    (field) => {
      // Un origen nuevo en `libs/shared` que no llegara aquí haría que Mongoose rechazara lo pegado al escribirlo.
      const entry = nestedSchema(previewSourcesSubSchema, field);
      const enumOf = (schema: Schema): unknown =>
        (schema.path('source').options as Record<string, unknown>)['enum'];

      expect(enumOf(entry)).toEqual([...PREVIEW_SOURCE_KINDS]);
      expect(enumOf(nestedSchema(entry, 'replaced'))).toEqual([
        ...PREVIEW_SOURCE_KINDS,
      ]);
    },
  );

  it.each([...PREVIEW_FIELD_NAMES])(
    'stores the displaced entry of %s with the same shape as the field',
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
