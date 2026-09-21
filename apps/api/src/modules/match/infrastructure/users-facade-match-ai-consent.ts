import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type { MatchAiConsent } from '../application/ports/ai-consent.port';

/**
 * Adaptador `MATCH_AI_CONSENT` sobre `UsersFacade.effectiveAiContextOf` (tarea 9.6). La vigencia del texto de
 * consentimiento se interpreta en `users`; aquí solo se lee el flag efectivo.
 */
@Injectable()
export class UsersFacadeMatchAiConsent implements MatchAiConsent {
  constructor(private readonly users: UsersFacade) {}

  async externalProvidersOf(userId: string): Promise<boolean> {
    const context = await this.users.effectiveAiContextOf(userId);
    return context.aiConsent.externalProviders;
  }
}
