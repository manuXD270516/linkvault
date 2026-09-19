import {
  PASTED_PREVIEW_EXTRACTOR,
  previewSourcesSchema,
  storedPreviewSchema,
  type JobPreview,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import { applyManualEdit } from './preview-edit';
import type { EditablePreview } from './preview-entry';
import {
  applyPastedPreview,
  effectiveHeader,
  failureKeptAfterPaste,
} from './preview-paste';
import { previewStatusOf } from './preview-status';

// Pegar la descripción sobre lo que ya estaba guardado (D3 y D6 de paste-job-description). Sin Mongo y sin Nest: es
// dominio. Lo que se guarda en `replaced` lo fija además la tabla `PREVIEW_REPLACED_CASES`, en `preview-edit.spec.ts`.

const ANA = '000000000000000000000001';
const BETO = '000000000000000000000002';
const READ_AT = '2026-09-17T09:00:00.000Z';
const BETO_AT = '2026-09-18T10:00:00.000Z';
const NOW = new Date('2026-09-18T12:00:00.000Z');
const AT = NOW.toISOString();

/** Link leído de la página: título por JSON-LD y empresa por metadatos. */
const readFromPage: EditablePreview = {
  preview: { title: 'Backend Engineer', company: 'ACME S.R.L.' },
  previewSources: {
    title: {
      value: 'Backend Engineer',
      source: 'auto',
      extractor: 'json-ld',
      at: READ_AT,
    },
    company: {
      value: 'ACME S.R.L.',
      source: 'auto',
      extractor: 'metadata',
      at: READ_AT,
    },
  },
};

/** Lo que la IA leyó de la oferta de Ana, con los huecos que devuelve un texto copiado de la app. */
const anasOffer: JobPreview = {
  title: 'Arquitecta de Datos',
  company: 'Datos Andinos',
  location: 'Cochabamba, Bolivia',
  modality: 'hybrid',
  seniority: 'unknown',
  salary: null,
  skills: [{ name: 'SQL', required: true }],
  languages: [],
  summary: 'Diseñar el modelo de datos de la plataforma.',
  postedAt: null,
  expiresAt: null,
};

function pastedEntry(value: unknown, by: string, at: string) {
  return {
    value,
    source: 'pasted',
    extractor: PASTED_PREVIEW_EXTRACTOR,
    by,
    at,
  };
}

describe('applyPastedPreview', () => {
  it('writes the fields read from the text with origin pasted, who pasted and when', () => {
    const pasted = applyPastedPreview(
      readFromPage,
      { extracted: anasOffer },
      ANA,
      NOW,
    );

    expect(pasted.changed).toBe(true);
    expect(pasted.previewSources.location).toEqual(
      pastedEntry('Cochabamba, Bolivia', ANA, AT),
    );
    expect(storedPreviewSchema.parse(pasted.preview)).toEqual(pasted.preview);
    expect(previewSourcesSchema.parse(pasted.previewSources)).toEqual(
      pasted.previewSources,
    );
  });

  it('Pegar no pisa lo escrito a mano', () => {
    const written = applyManualEdit(
      readFromPage,
      { fields: { title: 'Ingeniero de Backend' } },
      BETO,
      new Date(BETO_AT),
    );

    const pasted = applyPastedPreview(
      written,
      { extracted: anasOffer },
      ANA,
      NOW,
    );

    // El título sigue siendo el escrito a mano, con lo que guardaba para deshacerse intacto.
    expect(pasted.previewSources.title).toEqual(written.previewSources.title);
    expect(pasted.preview.title).toBe('Ingeniero de Backend');
    // Los campos que nadie escribió a mano toman lo pegado.
    expect(pasted.preview.company).toBe('Datos Andinos');
    expect(pasted.previewSources.company?.source).toBe('pasted');
  });

  it('Pegar no deja huecos', () => {
    const pasted = applyPastedPreview(
      readFromPage,
      { extracted: { ...anasOffer, company: null } },
      ANA,
      NOW,
    );

    expect(pasted.preview.company).toBe('ACME S.R.L.');
    expect(pasted.previewSources.company).toEqual(
      readFromPage.previewSources?.company,
    );
  });

  it('writes nothing for what says nothing: unknown, empty lists and nulls stay out', () => {
    const pasted = applyPastedPreview({}, { extracted: anasOffer }, ANA, NOW);

    expect(Object.keys(pasted.preview).sort()).toEqual(
      ['company', 'location', 'modality', 'skills', 'summary', 'title'].sort(),
    );
  });

  it('Título precargado sin tocar no se vuelve manual', () => {
    // El diálogo reenvía el título que ya mostraba la tarjeta, y la IA, que lo recibe como contexto, devuelve el mismo.
    const pasted = applyPastedPreview(
      readFromPage,
      {
        extracted: { ...anasOffer, title: 'Backend Engineer' },
        header: { title: 'Backend Engineer' },
      },
      ANA,
      NOW,
    );

    expect(pasted.previewSources.title).toEqual(
      readFromPage.previewSources?.title,
    );
    expect(
      previewStatusOf(pasted.preview, pasted.previewSources, undefined),
    ).toBe('enriched');
  });

  it('Cuerpo sin cabecera, con título y empresa escritos aparte', () => {
    const pasted = applyPastedPreview(
      {},
      {
        extracted: { ...anasOffer, title: 'Arquitecta', company: null },
        header: {
          title: 'Arquitecta de Datos Senior',
          company: 'Datos Andinos',
        },
      },
      ANA,
      NOW,
    );

    expect(pasted.previewSources.title).toEqual({
      value: 'Arquitecta de Datos Senior',
      source: 'manual',
      by: ANA,
      at: AT,
    });
    expect(pasted.previewSources.company?.source).toBe('manual');
    expect(pasted.previewSources.summary?.source).toBe('pasted');
    expect(pasted.preview.title).toBe('Arquitecta de Datos Senior');
    expect(pasted.preview.company).toBe('Datos Andinos');
  });

  it('a header written apart keeps what the page said, to go back to it', () => {
    const pasted = applyPastedPreview(
      readFromPage,
      { extracted: anasOffer, header: { title: 'Arquitecta de Datos Senior' } },
      ANA,
      NOW,
    );
    const title = pasted.previewSources.title;

    expect(title?.source === 'manual' ? title.replaced : undefined).toEqual(
      readFromPage.previewSources?.title,
    );
  });

  it('a pasted value equal to the one stored does not change its author', () => {
    const pasted = applyPastedPreview(
      readFromPage,
      { extracted: { title: 'Backend Engineer', company: 'ACME S.R.L.' } },
      ANA,
      NOW,
    );

    expect(pasted.changed).toBe(false);
    expect(pasted.previewSources).toEqual(readFromPage.previewSources);
  });

  it('La oferta equivocada, deshecha', () => {
    const byBeto = applyPastedPreview(
      readFromPage,
      {
        extracted: {
          title: 'Backend Engineer (Node)',
          company: 'Acme Bolivia',
        },
      },
      BETO,
      new Date(BETO_AT),
    );
    const byAna = applyPastedPreview(
      byBeto,
      { extracted: anasOffer },
      ANA,
      NOW,
    );

    const undone = applyManualEdit(
      byAna,
      { revert: ['title', 'company'] },
      ANA,
      new Date('2026-09-18T12:05:00.000Z'),
    );

    expect(undone.previewSources.title).toEqual(
      pastedEntry('Backend Engineer (Node)', BETO, BETO_AT),
    );
    expect(undone.previewSources.company).toEqual(
      pastedEntry('Acme Bolivia', BETO, BETO_AT),
    );
  });

  it('Volver a lo leído de la página', () => {
    const pasted = applyPastedPreview(
      readFromPage,
      { extracted: anasOffer },
      ANA,
      NOW,
    );

    const reverted = applyManualEdit(
      pasted,
      { revert: ['company'] },
      BETO,
      new Date('2026-09-18T12:05:00.000Z'),
    );

    expect(reverted.preview.company).toBe('ACME S.R.L.');
    expect(reverted.previewSources.company).toEqual(
      readFromPage.previewSources?.company,
    );
  });
});

describe('effectiveHeader', () => {
  it('ignores a title or company equal to what the link already had', () => {
    expect(
      effectiveHeader(readFromPage.preview, {
        title: 'Backend Engineer',
        company: 'Acme Bolivia',
      }),
    ).toEqual({ company: 'Acme Bolivia' });
  });

  it('keeps both when the link had nothing', () => {
    expect(effectiveHeader(undefined, { title: 'A', company: 'B' })).toEqual({
      title: 'A',
      company: 'B',
    });
  });
});

describe('previewStatusOf', () => {
  it('Estado tras completar con título y empresa', () => {
    const pasted = applyPastedPreview({}, { extracted: anasOffer }, ANA, NOW);

    expect(
      previewStatusOf(pasted.preview, pasted.previewSources, undefined),
    ).toBe('enriched');
  });

  it('is failed when nothing is left and a read had failed, which leaves the reason of the link as it was', () => {
    expect(
      previewStatusOf(
        {},
        {},
        { reason: 'robots_disallowed', at: NOW.toISOString() },
      ),
    ).toBe('failed');
  });

  it('is pending when nothing is left and nobody ever tried to read it', () => {
    // Sin motivo guardado no hubo lectura fallida: decir `failed` haría que la tarjeta contara "No pudimos leer esta
    // oferta" de una lectura que nunca ocurrió.
    expect(previewStatusOf({}, {}, undefined)).toBe('pending');
  });

  it('is partial without a company, and manual as soon as a person wrote a field', () => {
    const partial = applyPastedPreview(
      {},
      { extracted: { ...anasOffer, company: null } },
      ANA,
      NOW,
    );
    const manual = applyPastedPreview(
      {},
      { extracted: anasOffer, header: { company: 'Otra' } },
      ANA,
      NOW,
    );

    expect(
      previewStatusOf(partial.preview, partial.previewSources, undefined),
    ).toBe('partial');
    expect(
      previewStatusOf(manual.preview, manual.previewSources, undefined),
    ).toBe('manual');
  });
});

describe('failureKeptAfterPaste', () => {
  it.each(['robots_disallowed', 'blocked'] as const)(
    'El motivo de la bolsa se conserva: %s',
    (reason) => {
      const failure = { reason, at: READ_AT };
      expect(failureKeptAfterPaste(failure)).toEqual(failure);
    },
  );

  it.each(['timeout', 'http_error', 'no_data', 'rate_limited'] as const)(
    'keeps %s, so undoing the paste leaves the link failed and retryable',
    (reason) => {
      const failure = { reason, at: READ_AT };
      expect(failureKeptAfterPaste(failure)).toEqual(failure);
    },
  );

  it('turns not_a_job into no_data and keeps when it happened: the read did occur and gave no job posting', () => {
    expect(
      failureKeptAfterPaste({ reason: 'not_a_job', at: READ_AT }),
    ).toEqual({ reason: 'no_data', at: READ_AT });
  });

  it('keeps nothing when the link had not failed', () => {
    expect(failureKeptAfterPaste(undefined)).toBeUndefined();
  });
});
