import {
  deleteAccountRequestSchema,
  type DeleteAccountRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { DeleteAccount } from '../application/delete-account.usecase';

/**
 * Borrado de cuenta (spec users/account-deletion). Cableado desde `AppModule.register` (cascada + S3), no desde
 * `UsersModule`, para no reimportar `GroupsModule` y duplicar las rutas de `/api/groups`.
 */
@Controller('users')
export class AccountDeletionController {
  constructor(private readonly deleteAccount: DeleteAccount) {}

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(deleteAccountRequestSchema))
    body: DeleteAccountRequest,
  ): Promise<void> {
    await this.deleteAccount.execute(user.userId, body.password);
  }
}
