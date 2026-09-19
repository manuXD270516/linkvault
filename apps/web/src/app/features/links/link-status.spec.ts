import type { JobLinkSummary } from '@linkvault/shared';
import { linkCardStatus } from './link-status';

const now = new Date('2026-09-18T12:00:00.000Z');

const base: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

const pastedBy = {
  source: 'pasted',
  extractor: 'ai:extract-pasted-job',
  by: { userId: 'u1', displayName: 'Ana' },
  at: '2026-09-18T11:00:00.000Z',
} as const;

/**
 * Pegar conserva el motivo del último fallo de lectura (salvo `not_a_job`, que pasa a `no_data`). Una oferta con título
 * y empresa puede llevar entonces un fallo reintentable guardado: ya se lee sola y no debe ofrecer releerla.
 */
describe('linkCardStatus: una oferta legible con un fallo guardado', () => {
  const readable: JobLinkSummary = {
    ...base,
    preview: { title: 'Ingeniera de datos', company: 'Acme' },
    previewSources: {
      title: { ...pastedBy, value: 'Ingeniera de datos' },
      company: { ...pastedBy, value: 'Acme' },
    },
  };

  it.each([
    ['enriched', 'timeout'],
    ['manual', 'timeout'],
    ['enriched', 'no_data'],
    ['manual', 'no_data'],
  ] as const)('says nothing and offers no retry when %s with %s', (previewStatus, reason) => {
    const status = linkCardStatus(
      { ...readable, previewStatus, lastEnrichmentError: { reason, at: '2026-09-18T10:00:00.000Z' } },
      now,
    );

    expect(status).toEqual({
      text: null,
      needsHand: false,
      canRetry: false,
      notAnOffer: false,
      pasteFirst: false,
    });
  });

  /** Solo con título sigue sin leerse sola: releer es seguro porque la relectura no pisa lo pegado. */
  it('still offers a retry when the paste brought only the title', () => {
    const status = linkCardStatus(
      {
        ...base,
        previewStatus: 'partial',
        preview: { title: 'Ingeniera de datos' },
        previewSources: { title: { ...pastedBy, value: 'Ingeniera de datos' } },
        lastEnrichmentError: { reason: 'no_data', at: '2026-09-18T10:00:00.000Z' },
      },
      now,
    );

    expect(status.text).toBe('No pudimos leer esta oferta');
    expect(status.canRetry).toBe(true);
    expect(status.pasteFirst).toBe(false);
  });
});
