// Feedback «no me convence» (cv-suggestions-review, spec cv/suggestion-feedback). Sin texto del `after`.

export interface SuggestionFeedback {
  readonly id: string;
  readonly userId: string;
  readonly analysisId: string;
  readonly suggestionIndex: number;
  /** Hash corto del `after` de la sugerencia en el informe final. */
  readonly afterHash: string;
  readonly createdAt: Date;
}

export interface NewSuggestionFeedback {
  readonly id: string;
  readonly userId: string;
  readonly analysisId: string;
  readonly suggestionIndex: number;
  readonly afterHash: string;
  readonly createdAt: Date;
}
