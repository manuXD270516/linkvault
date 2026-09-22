import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type { SearchAiConsent } from '../application/ports/search-ai-consent.port';

/** Consentimiento efectivo vía `UsersFacade` (vigencia del texto en users). */
@Injectable()
export class UsersFacadeSearchAiConsent implements SearchAiConsent {
  constructor(private readonly users: UsersFacade) {}

  async of(userId: string): Promise<{ readonly externalProviders: boolean }> {
    return this.users.aiConsentOf(userId);
  }
}
