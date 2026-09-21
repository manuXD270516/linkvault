import { beforeEach, describe, expect, it } from 'vitest';
import { AnalysisNotFound } from '../domain/errors';
import { shortAfterHash } from '../domain/suggestion-feedback';
import type {
  NewSuggestionFeedback,
  SuggestionFeedback,
} from '../domain/suggestion-feedback.entity';
import type { SuggestionFeedbackRepository } from './ports/suggestion-feedback-repository.port';
import { RecordSuggestionFeedback } from './record-suggestion-feedback.usecase';
import {
  InMemoryAnalysisRepository,
  MovableMatchClock,
  sampleReport,
} from './testing/match-test-doubles';
import type { MatchAnalysis } from '../domain/analysis';

const ANA = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BETO = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ANALYSIS_ID = 'cccccccccccccccccccccccc';
const LINK_ID = 'dddddddddddddddddddddddd';
const CV_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

const AFTER = 'Incluir NestJS en el perfil.';

class InMemorySuggestionFeedbackRepository
  implements SuggestionFeedbackRepository
{
  readonly rows: SuggestionFeedback[] = [];
  private sequence = 0;

  nextId(): string {
    this.sequence += 1;
    return `66fb${String(this.sequence).padStart(20, '0')}`;
  }

  insert(feedback: NewSuggestionFeedback): Promise<SuggestionFeedback> {
    this.rows.push(feedback);
    return Promise.resolve(feedback);
  }
}

let analyses: InMemoryAnalysisRepository;
let feedbacks: InMemorySuggestionFeedbackRepository;
let clock: MovableMatchClock;
let useCase: RecordSuggestionFeedback;

function doneAnalysis(owner: string): MatchAnalysis {
  return {
    id: ANALYSIS_ID,
    userId: owner,
    linkId: LINK_ID,
    cvId: CV_ID,
    status: 'done',
    step: 'done',
    previewVersion: 1,
    promptVersion: 'v1',
    report: sampleReport({
      suggestions: [
        {
          section: 'skills',
          after: AFTER,
          reason: 'La vacante lo pide.',
          evidence: {
            jobRequirement: 'NestJS',
            importance: 'must',
            cvFragment: null,
          },
        },
      ],
    }),
    consentRequired: false,
    wentExternal: false,
    requestedAt: new Date('2026-09-20T12:00:00.000Z'),
    finishedAt: new Date('2026-09-20T12:01:00.000Z'),
    durationMs: 60_000,
  };
}

beforeEach(() => {
  analyses = new InMemoryAnalysisRepository();
  feedbacks = new InMemorySuggestionFeedbackRepository();
  clock = new MovableMatchClock();
  useCase = new RecordSuggestionFeedback(analyses, feedbacks, clock);
  analyses.seed(doneAnalysis(ANA));
});

describe('RecordSuggestionFeedback', () => {
  it('Ana marca una sugerencia suya', async () => {
    const result = await useCase.execute(ANA, ANALYSIS_ID, 0);

    expect(result).toMatchObject({
      analysisId: ANALYSIS_ID,
      suggestionIndex: 0,
      afterHash: shortAfterHash(AFTER),
    });
    expect(feedbacks.rows).toHaveLength(1);
    expect(feedbacks.rows[0]).toMatchObject({
      userId: ANA,
      analysisId: ANALYSIS_ID,
      suggestionIndex: 0,
      afterHash: shortAfterHash(AFTER),
    });
    // El informe no se muta.
    const again = await analyses.findById(ANALYSIS_ID);
    expect(again?.report?.suggestions[0]?.after).toBe(AFTER);
  });

  it('Beto no marca lo de Ana', async () => {
    await expect(useCase.execute(BETO, ANALYSIS_ID, 0)).rejects.toBeInstanceOf(
      AnalysisNotFound,
    );
    expect(feedbacks.rows).toEqual([]);
  });
});
