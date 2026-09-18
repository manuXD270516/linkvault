import type {
  ManualEditStoredEntry,
  PreviewSources,
  StoredPreview,
} from '@linkvault/shared';
import {
  MANUAL_EDIT_REPLACED_CASES,
  previewSourcesSchema,
  storedPreviewSchema,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREVIEW_STATE,
  applyManualField,
  mergeDrafts,
  mergeIntoStored,
  type PreviewState,
} from './merge';
import { draftFrom, hasAnyField, hasRequiredFields } from './preview-draft';

// Requisito "Preview con procedencia por campo" (specs/links/enrichment) y D4 de link-enrichment.

const AT = '2026-09-18T10:00:00.000Z';
const BEFORE = '2026-09-01T10:00:00.000Z';
const ANA = '68c0f0f0f0f0f0f0f0f0f0f0';

/** El estado del que parte un caso de `MANUAL_EDIT_REPLACED_CASES`, con su procedencia puesta en `title`. */
function storedForCase(entry: ManualEditStoredEntry | undefined): PreviewState {
  if (entry === undefined) return EMPTY_PREVIEW_STATE;
  return stateOf(
    { title: entry.value },
    {
      title:
        entry.source === 'auto'
          ? {
              value: entry.value,
              source: 'auto',
              extractor: entry.extractor,
              at: BEFORE,
            }
          : {
              value: entry.value,
              source: 'manual',
              by: ANA,
              at: BEFORE,
              ...(entry.replaced === undefined
                ? {}
                : { replaced: entry.replaced }),
            },
    },
  );
}

function stateOf(
  preview: StoredPreview,
  sources: PreviewSources,
): PreviewState {
  // Los literales de los tests pasan por los contratos de `libs/shared`: un test que se inventara una forma dejaría de
  // probar lo que de verdad se guarda.
  return {
    preview: storedPreviewSchema.parse(preview),
    sources: previewSourcesSchema.parse(sources),
  };
}

describe('Gana la etapa más fiable', () => {
  it('keeps the JSON-LD company when the AI proposes another one in the same pass', () => {
    const merged = mergeDrafts([
      draftFrom('json-ld', { company: 'Empresa Ejemplo' }),
      draftFrom('ai:extract-job', { company: 'Otra Empresa' }),
    ]);

    expect(merged.company).toEqual({
      value: 'Empresa Ejemplo',
      extractor: 'json-ld',
    });
  });

  it('says which extractor each field came from', () => {
    const merged = mergeIntoStored(
      EMPTY_PREVIEW_STATE,
      mergeDrafts([
        draftFrom('json-ld', { title: 'Arquitecto(a) de Soluciones' }),
        draftFrom('metadata', { title: 'Otro', location: 'La Paz' }),
        draftFrom('ai:extract-job', { company: 'Empresa Ejemplo' }),
      ]),
      AT,
    );

    expect(merged.sources).toEqual({
      title: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
        at: AT,
      },
      location: {
        value: 'La Paz',
        source: 'auto',
        extractor: 'metadata',
        at: AT,
      },
      company: {
        value: 'Empresa Ejemplo',
        source: 'auto',
        extractor: 'ai:extract-job',
        at: AT,
      },
    });
    expect(previewSourcesSchema.parse(merged.sources)).toEqual(merged.sources);
  });

  it('completes with later stages what the earlier ones did not read', () => {
    const merged = mergeDrafts([
      draftFrom('json-ld', { title: 'Arquitecto' }),
      draftFrom('metadata', {
        title: 'Arquitecto | Trabajopolis',
        summary: 'Resumen',
      }),
    ]);

    expect(merged.title?.extractor).toBe('json-ld');
    expect(merged.summary).toEqual({ value: 'Resumen', extractor: 'metadata' });
  });
});

describe('Lo manual no se pisa', () => {
  it('keeps the hand-written title and updates the rest', () => {
    const stored = stateOf(
      { title: 'Arquitecto de Soluciones (Java)', company: 'Vieja S.A.' },
      {
        title: {
          value: 'Arquitecto de Soluciones (Java)',
          source: 'manual',
          by: ANA,
          at: BEFORE,
        },
        company: {
          value: 'Vieja S.A.',
          source: 'auto',
          extractor: 'metadata',
          at: BEFORE,
        },
      },
    );

    const merged = mergeIntoStored(
      stored,
      draftFrom('json-ld', {
        title: 'Arquitecto(a) de Soluciones',
        company: 'Empresa Ejemplo',
      }),
      AT,
    );

    expect(merged.preview.title).toBe('Arquitecto de Soluciones (Java)');
    expect(merged.sources.title).toEqual({
      value: 'Arquitecto de Soluciones (Java)',
      source: 'manual',
      by: ANA,
      at: BEFORE,
    });
    expect(merged.preview.company).toBe('Empresa Ejemplo');
    expect(merged.sources.company?.source).toBe('auto');
  });

  it('does not lose what a manual edit had displaced', () => {
    const stored = applyManualField(
      stateOf(
        { title: 'Arquitecto(a) de Soluciones' },
        {
          title: {
            value: 'Arquitecto(a) de Soluciones',
            source: 'auto',
            extractor: 'json-ld',
            at: BEFORE,
          },
        },
      ),
      'title',
      'Arquitecto de Soluciones (Java)',
      ANA,
      BEFORE,
    );

    const merged = mergeIntoStored(
      stored,
      draftFrom('metadata', { title: 'Otro más' }),
      AT,
    );

    expect(merged.sources.title).toMatchObject({
      source: 'manual',
      replaced: { value: 'Arquitecto(a) de Soluciones', extractor: 'json-ld' },
    });
  });
});

describe('Reenriquecimiento con datos nuevos', () => {
  it('replaces an old JSON-LD title with the one the AI reads now', () => {
    // Frente a lo guardado gana lo nuevo aunque venga de una etapa menos fiable: la página pudo cambiar. Sin esto, un
    // preview equivocado sería inmutable para siempre.
    const stored = stateOf(
      { title: 'Título viejo' },
      {
        title: {
          value: 'Título viejo',
          source: 'auto',
          extractor: 'json-ld',
          at: BEFORE,
        },
      },
    );

    const merged = mergeIntoStored(
      stored,
      draftFrom('ai:extract-job', { title: 'Título nuevo' }),
      AT,
    );

    expect(merged.preview.title).toBe('Título nuevo');
    expect(merged.sources.title).toEqual({
      value: 'Título nuevo',
      source: 'auto',
      extractor: 'ai:extract-job',
      at: AT,
    });
  });

  it('keeps a stored field that this pass did not read', () => {
    const stored = stateOf(
      { title: 'Arquitecto', company: 'Empresa Ejemplo' },
      {
        title: {
          value: 'Arquitecto',
          source: 'auto',
          extractor: 'json-ld',
          at: BEFORE,
        },
        company: {
          value: 'Empresa Ejemplo',
          source: 'auto',
          extractor: 'json-ld',
          at: BEFORE,
        },
      },
    );

    const merged = mergeIntoStored(
      stored,
      draftFrom('metadata', { title: 'Otro' }),
      AT,
    );

    expect(merged.preview.company).toBe('Empresa Ejemplo');
    expect(merged.sources.company?.at).toBe(BEFORE);
  });

  it('keeps a stored value that has no provenance at all', () => {
    const merged = mergeIntoStored(
      {
        preview: { summary: 'De antes de que hubiera procedencia' },
        sources: {},
      },
      draftFrom('json-ld', { title: 'Arquitecto' }),
      AT,
    );

    expect(merged.preview.summary).toBe('De antes de que hubiera procedencia');
    expect(merged.sources.summary).toBeUndefined();
  });
});

describe('Se guarda lo que la edición desplazó', () => {
  it('keeps the automatic value and its extractor', () => {
    const stored = stateOf(
      { title: 'Arquitecto(a) de Soluciones' },
      {
        title: {
          value: 'Arquitecto(a) de Soluciones',
          source: 'auto',
          extractor: 'json-ld',
          at: BEFORE,
        },
      },
    );

    const edited = applyManualField(
      stored,
      'title',
      'Arquitecto de Soluciones (Java)',
      ANA,
      AT,
    );

    expect(edited.preview.title).toBe('Arquitecto de Soluciones (Java)');
    expect(edited.sources.title).toEqual({
      value: 'Arquitecto de Soluciones (Java)',
      source: 'manual',
      by: ANA,
      at: AT,
      replaced: { value: 'Arquitecto(a) de Soluciones', extractor: 'json-ld' },
    });
    expect(previewSourcesSchema.parse(edited.sources)).toEqual(edited.sources);
  });

  // La misma tabla la itera el spec de `applyManualEdit` en `api`: las dos funciones aplican esta regla y el código
  // está duplicado a propósito, así que lo que se comparte son los casos. Si una de las dos cambia, el otro spec se
  // pone en rojo.
  it.each(MANUAL_EDIT_REPLACED_CASES)(
    '$name',
    ({ stored, edit, expected }) => {
      const edited = applyManualField(
        storedForCase(stored),
        'title',
        edit,
        ANA,
        AT,
      );
      const entry = edited.sources.title;

      expect(edited.preview.title).toBe(edit);
      expect(entry?.source === 'manual' ? entry.replaced : undefined).toEqual(
        expected,
      );
    },
  );
});

describe('Tabla de merges', () => {
  const stored = stateOf(
    { title: 'Guardado', company: 'Guardada S.A.', location: 'La Paz' },
    {
      title: {
        value: 'Guardado',
        source: 'auto',
        extractor: 'json-ld',
        at: BEFORE,
      },
      company: {
        value: 'Guardada S.A.',
        source: 'manual',
        by: ANA,
        at: BEFORE,
      },
      location: {
        value: 'La Paz',
        source: 'auto',
        extractor: 'metadata',
        at: BEFORE,
      },
    },
  );

  const cases: {
    name: string;
    proposed: Partial<
      Record<'title' | 'company' | 'location' | 'summary', string>
    >;
    field: 'title' | 'company' | 'location' | 'summary';
    value: string | undefined;
    source: 'auto' | 'manual' | undefined;
  }[] = [
    {
      name: 'campo ausente en la pasada: se conserva el guardado',
      proposed: {},
      field: 'title',
      value: 'Guardado',
      source: 'auto',
    },
    {
      name: 'campo vacío en la pasada: no es una propuesta',
      proposed: { title: '   ' },
      field: 'title',
      value: 'Guardado',
      source: 'auto',
    },
    {
      name: 'dos automáticos: gana el nuevo',
      proposed: { title: 'Nuevo' },
      field: 'title',
      value: 'Nuevo',
      source: 'auto',
    },
    {
      name: 'automático contra manual: gana el manual',
      proposed: { company: 'Empresa Ejemplo' },
      field: 'company',
      value: 'Guardada S.A.',
      source: 'manual',
    },
    {
      name: 'campo nuevo que nadie había escrito: entra',
      proposed: { summary: 'Un resumen' },
      field: 'summary',
      value: 'Un resumen',
      source: 'auto',
    },
    {
      name: 'campo que nadie ha escrito nunca: no aparece',
      proposed: {},
      field: 'summary',
      value: undefined,
      source: undefined,
    },
  ];

  it.each(cases)('$name', ({ proposed, field, value, source }) => {
    const merged = mergeIntoStored(stored, draftFrom('metadata', proposed), AT);

    expect(merged.preview[field]).toBe(value);
    expect(merged.sources[field]?.source).toBe(source);
  });
});

describe('Campos obligatorios', () => {
  it('needs title and company to be complete', () => {
    expect(hasRequiredFields({ title: 'Arquitecto', company: 'Empresa' })).toBe(
      true,
    );
    expect(hasRequiredFields({ title: 'Arquitecto' })).toBe(false);
    expect(hasRequiredFields({ title: 'Arquitecto', company: null })).toBe(
      false,
    );
    expect(hasRequiredFields({})).toBe(false);
  });

  it('tells a preview with something from one with nothing', () => {
    expect(hasAnyField({ title: 'Arquitecto' })).toBe(true);
    expect(hasAnyField({ modality: 'unknown', skills: [] })).toBe(false);
    expect(hasAnyField({})).toBe(false);
  });
});
