import type { DynamicModule } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { DeleteAllMyAiKeys } from '../application/delete-all-my-ai-keys.usecase';
import { DeleteMyAiKey } from '../application/delete-my-ai-key.usecase';
import { ListMyAiKeys } from '../application/list-my-ai-keys.usecase';
import { USERS_CLOCK } from '../application/ports/clock.port';
import { UpsertMyAiKey } from '../application/upsert-my-ai-key.usecase';
import { SystemClock } from '../infrastructure/system-clock';
import { AiKeysController } from './ai-keys.controller';

/**
 * HTTP thin de BYOK (`/users/me/ai-keys…`). Importa el mismo `AiModule` de `AppModule` para
 * `SECRET_VAULT` y `USER_AI_KEYS_REPOSITORY` (ADR-032 D1). El perfil sigue en `UsersModule`.
 */
@Module({})
export class AiKeysModule {
  static register(aiModule: DynamicModule): DynamicModule {
    return {
      module: AiKeysModule,
      imports: [aiModule],
      controllers: [AiKeysController],
      providers: [
        { provide: USERS_CLOCK, useClass: SystemClock },
        ListMyAiKeys,
        UpsertMyAiKey,
        DeleteMyAiKey,
        DeleteAllMyAiKeys,
      ],
    };
  }
}
