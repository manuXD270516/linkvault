import type { PreviewSources, StoredPreview } from '@linkvault/shared';
import {
  PASTED_PREVIEW_EXTRACTOR,
  draftFrom,
  hasAnyField,
  hasRequiredFields,
  previewSourcesSchema,
  storedPreviewSchema,
} from '@linkvault/shared';
import {
  CASE_ACTED_AT,
  CASE_ACTOR,
  PREVIEW_REPLACED_CASES,
  type ReplacedCaseStored,
} from '@linkvault/testing';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_PREVIEW_STATE,
  mergeDrafts,
  mergeIntoStored,
  type PreviewState,
} from './merge';
import { applyManualField } from './testing/manual-field';

// Requisito "Preview con procedencia por campo" (specs/links/enrichment) y D4 de link-enrichment.

const AT = '2026-09-18T10:00:00.000Z';
const BEFORE = '2026-09-01T10:00:00.000Z';
const ANA = '68c0f0f0f0f0f0f0f0f0f0f0';
const BETO = '68c0b0b0b0b0b0b0b0b0b0b0';

/**
 * El estado del que parte un caso de `PREVIEW_REPLACED_CASES`, con su procedencia puesta en `title`. Pasa por el
 * contrato de `libs/shared`, que es como se lee lo guardado: un `replaced` antiguo sin origen llega ya como `auto`.
 */
function storedForCase(stored: ReplacedCaseStored | undefined): PreviewState {
  if (stored === undefined) return EMPTY_PREVIEW_STATE;
  return {
    preview: storedPreviewSchema.parse({ title: stored.value }),
    sources: previewSourcesSchema.parse({ title: stored }),
  };
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

  it('Lo manual no se pisa', () => {
    // Un campo escrito a mano sobre lo que otra persona pegó: la relectura no toca ni el valor ni lo que guardaba para
    // deshacerse, y los campos que nadie escribió a mano sí se actualizan.
    const stored = stateOf(
      { title: 'Arquitecto de Soluciones (Java)', company: 'Vieja S.A.' },
      {
        title: {
          value: 'Arquitecto de Soluciones (Java)',
          source: 'manual',
          by: ANA,
          at: BEFORE,
          replaced: {
            value: 'Arquitecto de Soluciones',
            source: 'pasted',
            extractor: PASTED_PREVIEW_EXTRACTOR,
            by: BETO,
            at: '2026-08-30T10:00:00.000Z',
          },
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

    expect(merged.sources.title).toEqual(stored.sources.title);
    expect(merged.preview.title).toBe('Arquitecto de Soluciones (Java)');
    expect(merged.sources.company).toEqual({
      value: 'Empresa Ejemplo',
      source: 'auto',
      extractor: 'json-ld',
      at: AT,
    });
  });
});

describe('Lo pegado no se pisa', () => {
  const pasted = stateOf(
    { title: 'Arquitecto(a) de Soluciones', company: 'Empresa Ejemplo' },
    {
      title: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
        at: BEFORE,
      },
      company: {
        value: 'Empresa Ejemplo',
        source: 'pasted',
        extractor: PASTED_PREVIEW_EXTRACTOR,
        by: BETO,
        at: BEFORE,
        replaced: {
          value: 'Empresa Ejemplo S.A.',
          source: 'auto',
          extractor: 'metadata',
          at: '2026-08-30T10:00:00.000Z',
        },
      },
    },
  );

  it('Una relectura no pisa lo pegado', () => {
    const merged = mergeIntoStored(
      pasted,
      draftFrom('json-ld', {
        title: 'Arquitecto de Soluciones Sr.',
        company: 'Otra Empresa',
      }),
      AT,
    );

    // La empresa sigue siendo la pegada, entera: con quien la pegó y con lo que guardaba para deshacerse.
    expect(merged.preview.company).toBe('Empresa Ejemplo');
    expect(merged.sources.company).toEqual(pasted.sources.company);
    // Lo que nadie pegó ni escribió sí se relee.
    expect(merged.preview.title).toBe('Arquitecto de Soluciones Sr.');
    expect(previewSourcesSchema.parse(merged.sources)).toEqual(merged.sources);
  });

  it('does not offer to go back where nobody acted: a re-read stores nothing it replaces', () => {
    const merged = mergeIntoStored(
      pasted,
      draftFrom('ai:extract-job', { title: 'Arquitecto de Soluciones Sr.' }),
      AT,
    );

    expect(merged.sources.title).toEqual({
      value: 'Arquitecto de Soluciones Sr.',
      source: 'auto',
      extractor: 'ai:extract-job',
      at: AT,
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
      replaced: {
        value: 'Arquitecto(a) de Soluciones',
        source: 'auto',
        extractor: 'json-ld',
        at: BEFORE,
      },
    });
    expect(previewSourcesSchema.parse(edited.sources)).toEqual(edited.sources);
  });

  // La misma tabla la itera el spec de `applyManualEdit` en `api`: lo que se comparte son los casos, no el código. El
  // worker no pega ni deshace, así que aquí solo corren los casos de escribir a mano.
  it.each(
    PREVIEW_REPLACED_CASES.filter((testCase) => testCase.action === 'manual'),
  )('$name', (testCase) => {
    if (testCase.action !== 'manual') return;
    const edited = applyManualField(
      storedForCase(testCase.stored),
      'title',
      testCase.value,
      CASE_ACTOR,
      CASE_ACTED_AT,
    );

    expect(edited.sources.title).toEqual(testCase.expected);
    expect(edited.preview.title).toBe(testCase.expected.value);
  });
});

describe('Tabla de merges', () => {
  const stored = stateOf(
    { title: 'Guardado', company: 'Guardada S.A.', location: 'Cochabamba' },
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
        value: 'Cochabamba',
        source: 'pasted',
        extractor: PASTED_PREVIEW_EXTRACTOR,
        by: BETO,
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
    source: 'auto' | 'pasted' | 'manual' | undefined;
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
      name: 'automático contra pegado: gana el pegado',
      proposed: { location: 'Santa Cruz' },
      field: 'location',
      value: 'Cochabamba',
      source: 'pasted',
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
