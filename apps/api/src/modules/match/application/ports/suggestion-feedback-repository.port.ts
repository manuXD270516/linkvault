import type {
  NewSuggestionFeedback,
  SuggestionFeedback,
} from '../../domain/suggestion-feedback.entity';

// Puerto de persistencia del feedback «no me convence» (colección `ai_feedback`).

export const SUGGESTION_FEEDBACK_REPOSITORY = Symbol(
  'SUGGESTION_FEEDBACK_REPOSITORY',
);

export interface SuggestionFeedbackRepository {
  /** Identificador antes de insertar. */
  nextId(): string;

  /** Inserta un feedback. No muta el informe del análisis. */
  insert(feedback: NewSuggestionFeedback): Promise<SuggestionFeedback>;
}
