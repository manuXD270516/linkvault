import { describe, expect, it } from 'vitest';
import {
  PENDING_EXTRACTION,
  nextVersion,
  promotedAfterRemoval,
  type CvDocumentEntity,
} from './cv-document';

function cv(
  overrides: Partial<CvDocumentEntity> & Pick<CvDocumentEntity, 'id'>,
): CvDocumentEntity {
  return {
    userId: 'u1',
    fileName: 'CV.pdf',
    fileType: 'pdf',
    sizeBytes: 1024,
    version: 1,
    isDefault: false,
    uploadedAt: new Date('2026-09-12T10:00:00.000Z'),
    extraction: PENDING_EXTRACTION,
    ...overrides,
  };
}

describe('nextVersion', () => {
  it('starts at one when there is nothing saved', () => {
    expect(nextVersion([])).toBe(1);
  });

  it('is one more than the highest used', () => {
    expect(nextVersion([1, 2, 3])).toBe(4);
  });

  it('does not reuse the number of a deleted CV', () => {
    // Quedan la 1 y la 2 porque se borró la 3: la siguiente es la 4, no la 3.
    expect(nextVersion([1, 2])).toBe(3);
    expect(nextVersion([1, 2, 4])).toBe(5);
  });

  it('ignores the order it receives them in', () => {
    expect(nextVersion([4, 1, 2])).toBe(5);
  });
});

describe('promotedAfterRemoval', () => {
  it('promotes the most recent of those left', () => {
    const older = cv({
      id: 'a',
      version: 1,
      uploadedAt: new Date('2026-09-10T10:00:00.000Z'),
    });
    const newer = cv({
      id: 'b',
      version: 2,
      uploadedAt: new Date('2026-09-12T10:00:00.000Z'),
    });

    expect(promotedAfterRemoval([older, newer])?.id).toBe('b');
    expect(promotedAfterRemoval([newer, older])?.id).toBe('b');
  });

  it('promotes nobody when nothing is left', () => {
    expect(promotedAfterRemoval([])).toBeUndefined();
  });

  it('breaks a tie in the upload date by version', () => {
    const at = new Date('2026-09-12T10:00:00.000Z');

    expect(
      promotedAfterRemoval([
        cv({ id: 'a', version: 3, uploadedAt: at }),
        cv({ id: 'b', version: 4, uploadedAt: at }),
      ])?.id,
    ).toBe('b');
  });

  it('does not care about the extraction state: the mark says which one to use', () => {
    const failed = cv({
      id: 'failed',
      version: 2,
      uploadedAt: new Date('2026-09-12T10:00:00.000Z'),
      extraction: {
        status: 'failed',
        failureReason: 'no_text',
        textChars: 0,
      },
    });
    const extracted = cv({
      id: 'extracted',
      version: 1,
      uploadedAt: new Date('2026-09-10T10:00:00.000Z'),
      extraction: { status: 'extracted', textChars: 8412 },
    });

    expect(promotedAfterRemoval([extracted, failed])?.id).toBe('failed');
  });
});

describe('PENDING_EXTRACTION', () => {
  it('is what a CV is born with', () => {
    expect(PENDING_EXTRACTION).toEqual({ status: 'pending', textChars: 0 });
  });
});
