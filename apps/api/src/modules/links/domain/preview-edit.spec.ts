import { previewSourcesSchema, storedPreviewSchema } from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { PreviewFieldUnknown } from './errors';
import { applyManualEdit, type EditablePreview } from './preview-edit';

// Mezcla de una edición manual con lo que ya estaba guardado (D4). Sin Mongo y sin Nest: es dominio.

const ANA = '000000000000000000000001';
const NOW = new Date('2026-09-18T12:00:00.000Z');
const AT = NOW.toISOString();

const extracted: EditablePreview = {
  preview: { title: 'Backend Engineer', company: 'ACME S.R.L.' },
  previewSources: {
    title: {
      value: 'Backend Engineer',
      source: 'auto',
      extractor: 'json-ld',
      at: '2026-09-18T11:00:00.000Z',
    },
    company: {
      value: 'ACME S.R.L.',
      source: 'auto',
      extractor: 'metadata',
      at: '2026-09-18T11:00:00.000Z',
    },
  },
};

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
      replaced: { value: 'Backend Engineer', extractor: 'json-ld' },
    });
    // Los demás campos no se tocan.
    expect(edited.preview.company).toBe('ACME S.R.L.');
    expect(storedPreviewSchema.parse(edited.preview)).toEqual(edited.preview);
    expect(previewSourcesSchema.parse(edited.previewSources)).toEqual(
      edited.previewSources,
    );
  });

  it('Se guarda lo que la edición desplazó, y una segunda edición no lo pierde', () => {
    const first = applyManualEdit(
      extracted,
      { fields: { title: 'Ingeniero de Backend' } },
      ANA,
      NOW,
    );

    const second = applyManualEdit(first, { fields: { title: 'Backend' } }, ANA, NOW);
    const entry = second.previewSources.title;

    // El valor desplazado sigue siendo el que leyó la máquina, no la primera corrección: "Volver a lo extraído"
    // promete devolver a la página, no a otra edición.
    expect(entry?.source === 'manual' ? entry.replaced : undefined).toEqual({
      value: 'Backend Engineer',
      extractor: 'json-ld',
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
    expect(reverted.previewSources.title).toEqual({
      value: 'Backend Engineer',
      source: 'auto',
      extractor: 'json-ld',
      at: AT,
    });
  });

  it('a field written by hand that displaced nothing goes back to having no value', () => {
    const edited = applyManualEdit(
      {},
      { fields: { location: 'La Paz' } },
      ANA,
      NOW,
    );

    const reverted = applyManualEdit(edited, { revert: ['location'] }, ANA, NOW);

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
    expect(entry?.source === 'manual' ? entry.replaced : undefined).toEqual({
      value: 'Backend Engineer',
      extractor: 'json-ld',
    });
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
