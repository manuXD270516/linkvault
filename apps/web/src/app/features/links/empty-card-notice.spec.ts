import type { JobLinkSummary } from '@linkvault/shared';
import { emptyCardNotice, emptyCardNoticeText } from './empty-card-notice';
import { READING_GRACE_MS, isStillReading } from './link-status';

const now = new Date('2026-09-18T12:00:00.000Z');
const recently = new Date(now.getTime() - 60_000).toISOString();
const longAgo = new Date(
  now.getTime() - READING_GRACE_MS - 60_000,
).toISOString();

const base: JobLinkSummary = {
  id: 'l1',
  normalizedUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  displayUrl: 'https://www.linkedin.com/jobs/view/3912345678',
  platform: 'linkedin',
  previewStatus: 'pending',
  previewVersion: 1,
  previewRequestedAt: recently,
  sharedBy: { userId: 'u1', displayName: 'Ana' },
  sharedAt: '2026-09-17T10:00:00.000Z',
};

describe('emptyCardNotice', () => {
  it('pending without title within READING_GRACE_MS → reading', () => {
    expect(emptyCardNotice(base, now)).toBe('reading');
  });

  it('stale pending → empty', () => {
    expect(emptyCardNotice({ ...base, previewRequestedAt: longAgo }, now)).toBe(
      'empty',
    );
  });

  it('pending with other data but no title → empty', () => {
    expect(
      emptyCardNotice({ ...base, preview: { company: 'Acme' } }, now),
    ).toBe('empty');
  });

  it('failed without title → empty', () => {
    const failed: JobLinkSummary = {
      ...base,
      previewStatus: 'failed',
      lastEnrichmentError: { reason: 'timeout', at: recently },
    };
    expect(emptyCardNotice(failed, now)).toBe('empty');
  });

  it('partial without title → empty', () => {
    expect(
      emptyCardNotice(
        { ...base, previewStatus: 'partial', preview: { company: 'Acme' } },
        now,
      ),
    ).toBe('empty');
  });

  it('manual without title → empty', () => {
    expect(
      emptyCardNotice(
        { ...base, previewStatus: 'manual', preview: { company: 'Acme' } },
        now,
      ),
    ).toBe('empty');
  });

  it('not_a_job → own text', () => {
    const notAJob: JobLinkSummary = {
      ...base,
      previewStatus: 'failed',
      lastEnrichmentError: { reason: 'not_a_job', at: recently },
    };
    expect(emptyCardNotice(notAJob, now)).toBe('notAJob');
    expect(emptyCardNoticeText('notAJob')).toBe(
      'Esto no parece una oferta: si lo envías, la tarjeta saldrá sin datos',
    );
    expect(emptyCardNoticeText('notAJob')).not.toContain('Complétala');
  });

  it('a title completed by hand → none', () => {
    const failedThenCompleted: JobLinkSummary = {
      ...base,
      previewStatus: 'manual',
      preview: { title: 'Ingeniera de datos' },
      lastEnrichmentError: { reason: 'timeout', at: recently },
    };
    expect(emptyCardNotice(failedThenCompleted, now)).toBeNull();
  });

  it.each(['pending', 'enriched', 'partial', 'failed', 'manual'] as const)(
    'any status with title → none (%s)',
    (previewStatus) => {
      expect(
        emptyCardNotice(
          { ...base, previewStatus, preview: { title: 'Ingeniera de datos' } },
          now,
        ),
      ).toBeNull();
    },
  );

  it('the texts carry no final period', () => {
    for (const kind of ['reading', 'empty', 'notAJob'] as const) {
      expect(emptyCardNoticeText(kind).endsWith('.')).toBe(false);
    }
    expect(emptyCardNoticeText('empty')).toBe(
      'La tarjeta todavía no tiene el puesto: si lo envías ahora, saldrá sin datos. Complétala antes desde la tarjeta',
    );
  });
});

describe('isStillReading', () => {
  it('is the condition under which the card says Leyendo la oferta…', () => {
    expect(isStillReading(base, now)).toBe(true);
    expect(isStillReading({ ...base, previewRequestedAt: longAgo }, now)).toBe(
      false,
    );
    expect(isStillReading({ ...base, preview: { company: 'Acme' } }, now)).toBe(
      false,
    );
    expect(
      isStillReading(
        { ...base, lastEnrichmentError: { reason: 'timeout', at: recently } },
        now,
      ),
    ).toBe(false);
  });
});
