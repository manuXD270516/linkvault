import {
  aiKeyViewSchema,
  aiVendorSchema,
  listAiKeysResponseSchema,
  upsertAiKeyRequestSchema,
  type AiKeyView,
  type AiVendor,
  type ListAiKeysResponse,
  type UpsertAiKeyRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { DeleteAllMyAiKeys } from '../application/delete-all-my-ai-keys.usecase';
import { DeleteMyAiKey } from '../application/delete-my-ai-key.usecase';
import { ListMyAiKeys } from '../application/list-my-ai-keys.usecase';
import { UpsertMyAiKey } from '../application/upsert-my-ai-key.usecase';

/**
 * Claves BYOK propias (spec ai/byok, ADR-032). Protegido como `/users/me`: solo el access token.
 * Respuestas validadas contra el contrato de `@linkvault/shared` (sin plaintext ni ciphertext).
 */
@Controller('users/me/ai-keys')
export class AiKeysController {
  constructor(
    private readonly listMyAiKeys: ListMyAiKeys,
    private readonly upsertMyAiKey: UpsertMyAiKey,
    private readonly deleteMyAiKey: DeleteMyAiKey,
    private readonly deleteAllMyAiKeys: DeleteAllMyAiKeys,
  ) {}

  @Get()
  async list(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListAiKeysResponse> {
    const body = await this.listMyAiKeys.execute(user.userId);
    return listAiKeysResponseSchema.parse(body);
  }

  @Put(':vendor')
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vendor', new ZodValidationPipe(aiVendorSchema)) vendor: AiVendor,
    @Body(new ZodValidationPipe(upsertAiKeyRequestSchema))
    body: UpsertAiKeyRequest,
  ): Promise<AiKeyView> {
    const view = await this.upsertMyAiKey.execute(user.userId, vendor, body);
    // La cabecera de esta clase prometía «respuestas validadas contra el contrato» y el PUT no lo estaba: el
    // conjunto cerrado de `ai/data-protection` («Secretos BYOK fuera de logs y respuestas») vale igual para esta
    // vista suelta que para el listado, y es la que el SPA lee justo después de guardar una clave.
    return aiKeyViewSchema.parse(view);
  }

  @Delete()
  @HttpCode(204)
  async removeAll(@CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.deleteAllMyAiKeys.execute(user.userId);
  }

  @Delete(':vendor')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('vendor', new ZodValidationPipe(aiVendorSchema)) vendor: AiVendor,
  ): Promise<void> {
    await this.deleteMyAiKey.execute(user.userId, vendor);
  }
}
