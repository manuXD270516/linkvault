import { Inject, Injectable } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import {
  Types,
  type Connection,
  type Model,
  type Schema as MongooseSchema,
} from 'mongoose';
import type {
  NewSuggestionFeedback,
  SuggestionFeedback,
} from '../domain/suggestion-feedback.entity';
import type { SuggestionFeedbackRepository } from '../application/ports/suggestion-feedback-repository.port';
import {
  AI_FEEDBACK_COLLECTION,
  FEEDBACK_MODEL_NAME,
  suggestionFeedbackSchema,
  toFeedbackObjectId,
  toFeedbackUserObjectId,
  type SuggestionFeedbackDocument,
} from './feedback.schemas';

// Adaptador Mongo de SUGGESTION_FEEDBACK_REPOSITORY sobre `ai_feedback`.

@Injectable()
export class MongoSuggestionFeedbackRepository
  implements SuggestionFeedbackRepository
{
  private readonly feedbacks: Model<SuggestionFeedbackDocument>;

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
  ) {
    this.feedbacks = modelOf(
      connection,
      FEEDBACK_MODEL_NAME,
      suggestionFeedbackSchema,
    );
  }

  nextId(): string {
    return new Types.ObjectId().toHexString();
  }

  async insert(feedback: NewSuggestionFeedback): Promise<SuggestionFeedback> {
    const id = toFeedbackObjectId(feedback.id);
    const userId = toFeedbackUserObjectId(feedback.userId);
    const analysisId = toFeedbackObjectId(feedback.analysisId);
    if (id === null || userId === null || analysisId === null) {
      throw new Error('Saving feedback needs well formed ids');
    }
    await this.feedbacks.create({
      _id: id,
      userId,
      analysisId,
      suggestionIndex: feedback.suggestionIndex,
      afterHash: feedback.afterHash,
      createdAt: feedback.createdAt,
    });
    return feedback;
  }
}

function modelOf<T>(
  connection: Connection,
  name: string,
  schema: MongooseSchema<T>,
): Model<T> {
  return (
    (connection.models[name] as Model<T> | undefined) ??
    connection.model<T>(name, schema)
  );
}

export { AI_FEEDBACK_COLLECTION };
