import {
  changePasswordRequestSchema,
  forgotPasswordRequestSchema,
  loginRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  verifyEmailRequestSchema,
  type AuthEmailAckResponse,
  type ChangePasswordRequest,
  type ForgotPasswordRequest,
  type LoginRequest,
  type RegisterRequest,
  type ResetPasswordRequest,
  type SessionResponse,
  type VerifyEmailRequest,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ApiConfig } from '../../../infrastructure/config/api-config.schema';
import { APP_CONFIG } from '../../../infrastructure/config/app-config.module';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { ChangePassword } from '../application/change-password.usecase';
import { ForgotPassword } from '../application/forgot-password.usecase';
import type { IssuedSession } from '../application/issued-session';
import { Login } from '../application/login.usecase';
import { Logout } from '../application/logout.usecase';
import { CLOCK } from '../application/ports/clock.port';
import { RefreshSession } from '../application/refresh-session.usecase';
import { Register } from '../application/register.usecase';
import { ResendVerificationEmail } from '../application/resend-verification-email.usecase';
import { ResetPassword } from '../application/reset-password.usecase';
import { VerifyEmail } from '../application/verify-email.usecase';
import type { Clock } from '../domain/clock';
import { InvalidRefresh } from '../domain/errors';
import {
  clearRefreshCookie,
  isRefreshCookieSecure,
  readRefreshCookie,
  setRefreshCookie,
  type RefreshCookieReply,
  type RefreshCookieRequest,
} from './refresh-cookie';

/** Lo que el controlador usa de la petición de Fastify. */
export interface AuthHttpRequest extends RefreshCookieRequest {
  /** IP del cliente; sin `trustProxy`, la del socket (D7). */
  readonly ip: string;
}

/**
 * Endpoints de `/api/auth` (specs auth/credentials, sessions, email-verification, password-recovery).
 * CSRF vía `X-Requested-With` ya exigido por el hook. Rutas `@Public()`: register, login, refresh, logout,
 * forgot-password, reset-password, verify-email, extension/login, extension/refresh, extension/logout.
 * **No** pública: verify-email/resend. Extensión: ver `ExtensionAuthController` (ADR-038).
 */
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly register: Register,
    private readonly login: Login,
    private readonly refreshSession: RefreshSession,
    private readonly logout: Logout,
    private readonly changePassword: ChangePassword,
    private readonly forgotPassword: ForgotPassword,
    private readonly resetPassword: ResetPassword,
    private readonly verifyEmail: VerifyEmail,
    private readonly resendVerificationEmail: ResendVerificationEmail,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) config: ApiConfig,
  ) {
    this.secureCookie = isRefreshCookieSecure(config.NODE_ENV);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async registerUser(
    @Body(new ZodValidationPipe(registerRequestSchema)) body: RegisterRequest,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) reply: RefreshCookieReply,
  ): Promise<SessionResponse> {
    const session = await this.register.execute({ ...body, ip: request.ip });
    return this.startSession(reply, session);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async loginUser(
    @Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest,
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) reply: RefreshCookieReply,
  ): Promise<SessionResponse> {
    const session = await this.login.execute({ ...body, ip: request.ip });
    return this.startSession(reply, session);
  }

  /**
   * Rota el refresh token de la cookie. `invalid_refresh` borra la cookie; `refresh_conflict` (409) no la toca: otra
   * petición del mismo navegador ya fijó la del sucesor.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) reply: RefreshCookieReply,
  ): Promise<SessionResponse> {
    let session: IssuedSession;
    try {
      session = await this.refreshSession.execute({
        refreshToken: readRefreshCookie(request),
        expectedClient: 'web',
      });
    } catch (error) {
      if (error instanceof InvalidRefresh) {
        clearRefreshCookie(reply, { secure: this.secureCookie });
      }
      throw error;
    }
    return this.startSession(reply, session);
  }

  /**
   * Revoca la sesión del refresh token de la cookie, si lo hay, y borra la cookie. Responde 204 también sin cookie o con un
   * token inválido o ya rotado.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutSession(
    @Req() request: AuthHttpRequest,
    @Res({ passthrough: true }) reply: RefreshCookieReply,
  ): Promise<void> {
    await this.logout.execute({ refreshToken: readRefreshCookie(request) });
    clearRefreshCookie(reply, { secure: this.secureCookie });
  }

  /**
   * Cambio de contraseña autenticado (no `@Public()`): revoca las demás sesiones del usuario y conserva la del access token.
   * No toca la cookie: el refresh token de esta sesión sigue valiendo, y el access token actual deja de valer por
   * `passwordChangedAt` (el SPA renueva en la petición siguiente).
   */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changeUserPassword(
    @Body(new ZodValidationPipe(changePasswordRequestSchema))
    body: ChangePasswordRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.changePassword.execute({
      userId: user.userId,
      sessionId: user.sessionId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotUserPassword(
    @Body(new ZodValidationPipe(forgotPasswordRequestSchema))
    body: ForgotPasswordRequest,
    @Req() request: AuthHttpRequest,
  ): Promise<AuthEmailAckResponse> {
    return this.forgotPassword.execute({ email: body.email, ip: request.ip });
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetUserPassword(
    @Body(new ZodValidationPipe(resetPasswordRequestSchema))
    body: ResetPasswordRequest,
  ): Promise<void> {
    await this.resetPassword.execute({
      token: body.token,
      newPassword: body.newPassword,
    });
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyUserEmail(
    @Body(new ZodValidationPipe(verifyEmailRequestSchema))
    body: VerifyEmailRequest,
  ): Promise<void> {
    await this.verifyEmail.execute({ token: body.token });
  }

  /** Solo autenticado: el email del body (si viene) se ignora; destinatario = sesión. */
  @Post('verify-email/resend')
  @HttpCode(HttpStatus.OK)
  async resendVerification(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: AuthHttpRequest,
  ): Promise<AuthEmailAckResponse> {
    return this.resendVerificationEmail.execute({
      userId: user.userId,
      ip: request.ip,
    });
  }

  /** Fija la cookie con el refresh token y devuelve el cuerpo sin él. */
  private startSession(
    reply: RefreshCookieReply,
    session: IssuedSession,
  ): SessionResponse {
    setRefreshCookie(reply, session.refreshToken, {
      expiresAt: session.refreshExpiresAt,
      now: this.clock.now(),
      secure: this.secureCookie,
    });
    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      user: session.user,
    };
  }
}
