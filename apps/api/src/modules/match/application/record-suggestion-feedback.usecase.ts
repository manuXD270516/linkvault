import type { SuggestionFeedbackAccepted } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { AnalysisNotFound } from '../domain/errors';
import { shortAfterHash } from '../domain/suggestion-feedback';
import {
  ANALYSIS_REPOSITORY,
  type AnalysisRepository,
} from './ports/analysis-repository.port';
import { MATCH_CLOCK, type MatchClock } from './ports/clock.port';
import {
  SUGGESTION_FEEDBACK_REPOSITORY,
  type SuggestionFeedbackRepository,
} from './ports/suggestion-feedback-repository.port';

/**
 * `POST /api/analyses/:analysisId/suggestion-feedback` (spec cv/suggestion-feedback): marca «no me convence»
 * sobre una sugerencia del informe final propio. No reescribe el informe. Un análisis ajeno → `analysis_not_found`.
 */
@Injectable()
export class RecordSuggestionFeedback {
  constructor(
    @Inject(ANALYSIS_REPOSITORY) private readonly analyses: AnalysisRepository,
    @Inject(SUGGESTION_FEEDBACK_REPOSITORY)
    private readonly feedbacks: SuggestionFeedbackRepository,
    @Inject(MATCH_CLOCK) private readonly clock: MatchClock,
  ) {}

  async execute(
    userId: string,
    analysisId: string,
    suggestionIndex: number,
  ): Promise<SuggestionFeedbackAccepted> {
    const analysis = await this.analyses.findById(analysisId);
    if (analysis === null || analysis.userId !== userId) {
      throw new AnalysisNotFound();
    }
    if (analysis.status !== 'done' || analysis.report === undefined) {
      throw new AnalysisNotFound();
    }
    const suggestion = analysis.report.suggestions[suggestionIndex];
    if (suggestion === undefined) {
      throw new AnalysisNotFound();
    }

    const afterHash = shortAfterHash(suggestion.after);
    const createdAt = this.clock.now();
    const saved = await this.feedbacks.insert({
      id: this.feedbacks.nextId(),
      userId,
      analysisId,
      suggestionIndex,
      afterHash,
      createdAt,
    });

    return {
      feedbackId: saved.id,
      analysisId: saved.analysisId,
      suggestionIndex: saved.suggestionIndex,
      afterHash: saved.afterHash,
      createdAt: saved.createdAt.toISOString(),
    };
  }
}
