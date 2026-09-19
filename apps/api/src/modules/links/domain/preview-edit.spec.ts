import { previewSourcesSchema, storedPreviewSchema } from '@linkvault/shared';
import {
  CASE_ACTED_AT,
  CASE_ACTOR,
  PREVIEW_REPLACED_CASES,
  type ReplacedCaseStored,
} from '@linkvault/testing';
import { describe, expect, it } from 'vitest';
import { PreviewFieldUnknown } from './errors';
import { applyManualEdit, type EditablePreview } from './preview-edit';
import { applyPastedPreview } from './preview-paste';

// Mezcla de una edición manual con lo que ya estaba guardado (D4). Sin Mongo y sin Nest: es dominio.

const ANA = '000000000000000000000001';
const NOW = new Date('2026-09-18T12:00:00.000Z');
const AT = NOW.toISOString();
const EXTRACTED_AT = '2026-09-18T11:00:00.000Z';

const extracted: EditablePreview = {
  preview: { title: 'Backend Engineer', company: 'ACME S.R.L.' },
  previewSources: {
    title: {
      value: 'Backend Engineer',
      source: 'auto',
      extractor: 'json-ld',
      at: EXTRACTED_AT,
    },
    company: {
      value: 'ACME S.R.L.',
      source: 'auto',
      extractor: 'metadata',
      at: EXTRACTED_AT,
    },
  },
};

/**
 * Lo guardado de un caso de `PREVIEW_REPLACED_CASES`, con su procedencia puesta en `title`. Pasa por el contrato de
 * `libs/shared`, que es como se lee lo guardado: un `replaced` antiguo sin origen llega ya como `auto`.
 */
function storedForCase(
  stored: ReplacedCaseStored | undefined,
): EditablePreview {
  if (stored === undefined) return {};
  return {
    preview: { title: stored.value },
    previewSources: previewSourcesSchema.parse({ title: stored }),
  };
}

describe('Se guarda lo que la edición desplazó', () => {
  // La misma tabla la itera el spec del worker: lo que se comparte son los casos, no el código. Si una de las dos
  // copias cambia lo que guarda para deshacer, el otro spec se pone en rojo.
  it.each(
    PREVIEW_REPLACED_CASES.filter((testCase) => testCase.action !== 'pasted'),
  )('$name', (testCase) => {
    const edited = applyManualEdit(
      storedForCase(testCase.stored),
      testCase.action === 'revert'
        ? { revert: ['title'] }
        : { fields: { title: testCase.value } },
      CASE_ACTOR,
      new Date(CASE_ACTED_AT),
    );

    expect(edited.previewSources.title).toEqual(testCase.expected);
    expect(edited.preview.title).toEqual(testCase.expected?.value);
  });

  // Pegar lo aplica `applyPastedPreview`: la misma tabla, contra la función que corre al pegar.
  it.each(
    PREVIEW_REPLACED_CASES.filter((testCase) => testCase.action === 'pasted'),
  )('$name (applyPastedPreview)', (testCase) => {
    if (testCase.action !== 'pasted') return;
    const pasted = applyPastedPreview(
      storedForCase(testCase.stored),
      { extracted: { title: testCase.value } },
      CASE_ACTOR,
      new Date(CASE_ACTED_AT),
    );

    expect(pasted.previewSources.title).toEqual(testCase.expected);
    expect(pasted.preview.title).toEqual(testCase.expected.value);
  });
});

describe('applyManualEdit', () => {
  it('Corregir el título', () => {
    const edited = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    expect(edited.changed).toBe(true);
    expect(edited.preview.title).toBe('Ingeniero de Backend');
    expect(edited.previewSources.title).toEqual({
      value: 'Ingeniero de Backend',
      source: 'manual',
      by: ANA,
      at: AT,
      replaced: {
        value: 'Backend Engineer',
        source: 'auto',
        extractor: 'json-ld',
        at: EXTRACTED_AT,
      },
    });
    // Los demás campos no se tocan.
    expect(edited.preview.company).toBe('ACME S.R.L.');
    expect(storedPreviewSchema.parse(edited.preview)).toEqual(edited.preview);
    expect(previewSourcesSchema.parse(edited.previewSources)).toEqual(
      edited.previewSources,
    );
  });

  it('a second edit keeps what the first one displaced', () => {
    const first = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    const second = applyManualEdit(
      first,
      { fields: { title: 'Backend' } },
      ANA,
      NOW,
    );
    const entry = second.previewSources.title;

    // Lo desplazado sigue siendo lo que leyó la máquina, no la primera corrección: "volver" desde un campo escrito a
    // mano devuelve a la fuente, no a otra edición.
    expect(entry?.source === 'manual' ? entry.replaced : undefined).toEqual(
      extracted.previewSources?.title,
    );
  });

  it('la misma edición dos veces: la segunda no cambia nada', () => {
    const first = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    const again = applyManualEdit(
      first,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    expect(again.changed).toBe(false);
    expect(again.previewSources.title).toEqual(first.previewSources.title);
  });

  it('compares values by shape, not by reference', () => {
    // Lo que llega de una petición HTTP nunca es la misma referencia que lo guardado: una lista de habilidades igual
    // campo por campo es la misma edición, y una con un nivel distinto no lo es.
    const written = applyManualEdit(
      {},
      { fields: { skills: [{ name: 'TypeScript', required: true }] } },
      ANA,
      NOW,
    );

    expect(
      applyManualEdit(
        written,
        { fields: { skills: [{ name: 'TypeScript', required: true }] } },
        ANA,
        NOW,
      ).changed,
    ).toBe(false);
    expect(
      applyManualEdit(
        written,
        { fields: { skills: [{ name: 'TypeScript', required: false }] } },
        ANA,
        NOW,
      ).changed,
    ).toBe(true);
  });

  it('writing by hand what the extraction read is a change, because it pins the field', () => {
    const edited = applyManualEdit(
      extracted,
      { fields: { title: 'Backend Engineer' } },
      ANA,
      NOW,
    );

    expect(edited.changed).toBe(true);
    expect(edited.previewSources.title).toEqual({
      value: 'Backend Engineer',
      source: 'manual',
      by: ANA,
      at: AT,
      replaced: {
        value: 'Backend Engineer',
        source: 'auto',
        extractor: 'json-ld',
        at: EXTRACTED_AT,
      },
    });
  });

  it('Volver a lo extraído', () => {
    const edited = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    const reverted = applyManualEdit(edited, { revert: ['title'] }, ANA, NOW);

    expect(reverted.changed).toBe(true);
    expect(reverted.preview.title).toBe('Backend Engineer');
    // Vuelve la entrada que se desplazó, tal cual: con la fecha en que se leyó, no con la de ahora.
    expect(reverted.previewSources.title).toEqual(
      extracted.previewSources?.title,
    );
  });

  it('a field written by hand that displaced nothing goes back to having no value', () => {
    const edited = applyManualEdit(
      {},
      { fields: { location: 'La Paz' } },
      ANA,
      NOW,
    );

    const reverted = applyManualEdit(
      edited,
      { revert: ['location'] },
      ANA,
      NOW,
    );

    expect(reverted.changed).toBe(true);
    expect(Object.keys(reverted.preview)).not.toContain('location');
    expect(Object.keys(reverted.previewSources)).not.toContain('location');
  });

  it('a pasted field that displaced nothing goes back to having no value', () => {
    const pasted: EditablePreview = {
      preview: { location: 'La Paz' },
      previewSources: {
        location: {
          value: 'La Paz',
          source: 'pasted',
          extractor: 'ai:extract-pasted-job',
          by: ANA,
          at: EXTRACTED_AT,
        },
      },
    };

    const reverted = applyManualEdit(
      pasted,
      { revert: ['location'] },
      ANA,
      NOW,
    );

    expect(reverted.changed).toBe(true);
    expect(Object.keys(reverted.preview)).not.toContain('location');
    expect(Object.keys(reverted.previewSources)).not.toContain('location');
  });

  it('reverting an automatic field or one nobody wrote changes nothing', () => {
    const untouched = applyManualEdit(
      extracted,
      { revert: ['title', 'summary'] },
      ANA,
      NOW,
    );

    expect(untouched.changed).toBe(false);
    expect(untouched.preview).toEqual(extracted.preview);
    expect(untouched.previewSources).toEqual(extracted.previewSources);
  });

  it('an empty edit changes nothing, so there is no version to raise', () => {
    expect(applyManualEdit(extracted, {}, ANA, NOW).changed).toBe(false);
  });

  it('writes a new value over the field it just gave back to what was extracted', () => {
    const edited = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    const both = applyManualEdit(
      edited,
      { fields: { title: 'Backend developer' }, revert: ['title'] },
      ANA,
      NOW,
    );
    const entry = both.previewSources.title;

    expect(both.preview.title).toBe('Backend developer');
    expect(entry?.source === 'manual' ? entry.replaced : undefined).toEqual(
      extracted.previewSources?.title,
    );
  });

  it.each([
    [{ fields: { image: 'https://example.com/a.png' } }],
    [{ revert: ['image'] }],
  ])('Campo desconocido: %j', (edit) => {
    expect(() => applyManualEdit(extracted, edit, ANA, NOW)).toThrow(
      PreviewFieldUnknown,
    );
    try {
      applyManualEdit(extracted, edit, ANA, NOW);
    } catch (error) {
      expect((error as PreviewFieldUnknown).field).toBe('image');
    }
  });

  it('keeps the shape of a value that is not a string', () => {
    const edited = applyManualEdit(
      {},
      { fields: { skills: [{ name: 'TypeScript', required: true }] } },
      ANA,
      NOW,
    );

    expect(storedPreviewSchema.parse(edited.preview)).toEqual(edited.preview);
    expect(edited.preview.skills).toEqual([
      { name: 'TypeScript', required: true },
    ]);
  });
});
