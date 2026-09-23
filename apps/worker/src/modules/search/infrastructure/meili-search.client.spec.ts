import { describe, expect, it } from 'vitest';
import { MEILI_FILTERABLE_ATTRIBUTES } from './meili-search.client';

describe('MEILI_FILTERABLE_ATTRIBUTES', () => {
  it('includes LatAm filterables and salary range (parity with api)', () => {
    expect([...MEILI_FILTERABLE_ATTRIBUTES]).toEqual([
      'id',
      'docType',
      'ownerUserId',
      'groupIds',
      'visibilityScope',
      'updatedAt',
      'embeddingStatus',
      'embedModelId',
      'embeddingDim',
      'closedAt',
      'modality',
      'status',
      'salaryCurrency',
      'salaryMin',
      'salaryMax',
    ]);
  });
});
