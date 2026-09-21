import {
  recordSuggestionFeedbackRequestSchema,
  type RecordSuggestionFeedbackRequest,
  type SuggestionFeedbackAccepted,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { RecordSuggestionFeedback } from '../application/record-suggestion-feedback.usecase';

/**
 * Feedback «no me convence» sobre una sugerencia del informe propio (spec cv/suggestion-feedback).
 */
@Controller('analyses')
export class SuggestionFeedbackController {
  private readonly logger = new Logger(SuggestionFeedbackController.name);

  constructor(private readonly recordFeedback: RecordSuggestionFeedback) {}

  @Post(':analysisId/suggestion-feedback')
  @HttpCode(HttpStatus.CREATED)
  async record(
    @CurrentUser() user: AuthenticatedUser,
    @Param('analysisId') analysisId: string,
    @Body(new ZodValidationPipe(recordSuggestionFeedbackRequestSchema))
    body: RecordSuggestionFeedbackRequest,
  ): Promise<SuggestionFeedbackAccepted> {
    const accepted = await this.recordFeedback.execute(
      user.userId,
      analysisId,
      body.suggestionIndex,
    );
    this.logger.debug({
      msg: 'suggestion-feedback.recorded',
      feedbackId: accepted.feedbackId,
      analysisId: accepted.analysisId,
      suggestionIndex: accepted.suggestionIndex,
    });
    return accepted;
  }
}
