import {
  updateProfileRequestSchema,
  type UpdateProfileRequest,
  type UserProfile,
} from '@linkvault/shared';
import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { GetMyProfile } from '../application/get-my-profile.usecase';
import { UpdateMyProfile } from '../application/update-my-profile.usecase';

/**
 * Perfil propio (spec users/profile). Protegido por el guard global: solo existe el usuario del access token.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly getMyProfile: GetMyProfile,
    private readonly updateMyProfile: UpdateMyProfile,
  ) {}

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser): Promise<UserProfile> {
    return this.getMyProfile.execute(user.userId);
  }

  @Patch('me')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProfileRequestSchema))
    changes: UpdateProfileRequest,
  ): Promise<UserProfile> {
    return this.updateMyProfile.execute(user.userId, changes);
  }
}
