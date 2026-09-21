import type { MatchSuggestion } from '@linkvault/shared';
import { sortSuggestionsByEvidence } from './sort-suggestions';

function suggestion(
  importance: 'must' | 'nice',
  after: string,
  jobRequirement = 'Req',
): MatchSuggestion {
  return {
    section: 'Experience',
    after,
    reason: 'reason',
    evidence: { jobRequirement, importance, cvFragment: null },
  };
}

describe('sortSuggestionsByEvidence', () => {
  it('Lo más importante va primero', () => {
    const sorted = sortSuggestionsByEvidence([
      suggestion('nice', 'nice-1'),
      suggestion('must', 'must-1'),
      suggestion('nice', 'nice-2'),
      suggestion('must', 'must-2'),
    ]);

    expect(sorted.map((item) => item.after)).toEqual(['must-1', 'must-2', 'nice-1', 'nice-2']);
  });

  it('drops suggestions without a job requirement', () => {
    const sorted = sortSuggestionsByEvidence([
      suggestion('must', 'keep', 'TypeScript'),
      suggestion('must', 'drop', '   '),
    ]);

    expect(sorted.map((item) => item.after)).toEqual(['keep']);
  });
});
