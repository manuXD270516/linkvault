import {
  extensionRefreshRequestSchema,
  loginRequestSchema,
  type ExtensionRefreshRequest,
  type ExtensionSessionResponse,
  type LoginRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import type { IssuedSession } from '../application/issued-session';
import { Login } from '../application/login.usecase';
import { Logout } from '../application/logout.usecase';
import { RefreshSession } from '../application/refresh-session.usecase';
import type { AuthHttpRequest } from './auth.controller';

/**
 * Auth de la extensión Chromium (ADR-038): refresh en body JSON, sin cookie `lv_refresh` en éxito ni error.
 * CSRF `X-Requested-With` lo exige el hook de `POST /api/auth/*`. Login reusa `Login` + `ATTEMPT_LIMITER`.
 */
@Controller('auth/extension')
export class ExtensionAuthController {
  constructor(
    private readonly login: Login,
    private readonly refreshSession: RefreshSession,
    private readonly logout: Logout,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async loginExtension(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: AuthHttpRequest,
  ): Promise<ExtensionSessionResponse> {
    const session = await this.login.execute({
      ...body,
      ip: request.ip,
      client: 'extension',
    });
    return toExtensionSession(session);
  }

  /**
   * Rota un refresh de sesión `extension`. Nunca fija ni borra `lv_refresh` (ni en 401/409).
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshExtension(
    @Body(new ZodValidationPipe(extensionRefreshRequestSchema))
    body: ExtensionRefreshRequest,
  ): Promise<ExtensionSessionResponse> {
    const session = await this.refreshSession.execute({
      refreshToken: body.refreshToken,
      expectedClient: 'extension',
    });
    return toExtensionSession(session);
  }

  /**
   * Revoca la familia del refresh del body. Idempotente → 204. No toca cookies SPA.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutExtension(
    @Body(new ZodValidationPipe(extensionRefreshRequestSchema))
    body: ExtensionRefreshRequest,
  ): Promise<void> {
    await this.logout.execute({ refreshToken: body.refreshToken });
  }
}

function toExtensionSession(session: IssuedSession): ExtensionSessionResponse {
  return {
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
    refreshToken: session.refreshToken,
  };
}
