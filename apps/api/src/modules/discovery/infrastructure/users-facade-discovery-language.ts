import type { OutputLanguage } from '@linkvault/shared';
import { Injectable } from '@nestjs/common';
import { UsersFacade } from '../../users/application/users.facade';
import type { DiscoveryUserLanguage } from '../application/ports/discovery-user-language.port';

/** Idioma del perfil vía UsersFacade; default `es` si no hay usuario. */
@Injectable()
export class UsersFacadeDiscoveryLanguage implements DiscoveryUserLanguage {
  constructor(private readonly users: UsersFacade) {}

  async getOutputLanguage(userId: string): Promise<OutputLanguage> {
    const ctx = await this.users.effectiveAiContextOf(userId);
    return ctx.outputLanguage;
  }
}
