import { Inject, Injectable } from '@nestjs/common';
import { InvalidRefresh, RefreshConflict } from '../domain/errors';
import type { SessionClient } from '../domain/session-client';
import type { IssuedSession } from './issued-session';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from './ports/access-token-signer.port';
import {
  AUTH_SECURITY_LOG,
  type AuthSecurityLog,
} from './ports/auth-security-log.port';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';
import { generateRefreshToken, hashRefreshToken } from './refresh-token';

export interface RefreshSessionInput {
  /** Valor de la cookie `lv_refresh` (web) o del body (extensión). */
  readonly refreshToken?: string;
  /**
   * Cliente que la ruta espera (ADR-038). Default `web` para el path cookie.
   * Sesión del otro cliente → `invalid_refresh` sin rotar.
   */
  readonly expectedClient?: SessionClient;
}

/**
 * `POST /api/auth/refresh` y `POST /api/auth/extension/refresh` (spec auth/sessions + ADR-038). Rota el refresh y
 * emite un access nuevo de la misma sesión. `RefreshConflict` (409) si se rotó hace menos de 10 s; `InvalidRefresh`
 * (401) si falta, es desconocido, caducó, su sesión está revocada, es del otro cliente o se reusó. El reuso ya dejó la
 * sesión revocada y se avisa con `userId` y `sessionId`, nunca con tokens. El presentador web borra cookie en
 * `InvalidRefresh`; el de extensión no toca cookies.
 */
@Injectable()
export class RefreshSession {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ACCESS_TOKEN_SIGNER) private readonly signer: AccessTokenSigner,
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(AUTH_SECURITY_LOG) private readonly securityLog: AuthSecurityLog,
  ) {}

  async execute(input: RefreshSessionInput): Promise<IssuedSession> {
    if (!input.refreshToken) {
      throw new InvalidRefresh('missing_token');
    }
    const successor = generateRefreshToken();
    const result = await this.sessions.rotate({
      tokenHash: hashRefreshToken(input.refreshToken),
      successorHash: successor.tokenHash,
      expectedClient: input.expectedClient ?? 'web',
    });

    switch (result.outcome) {
      case 'invalid':
        throw new InvalidRefresh(result.reason);
      case 'conflict':
        throw new RefreshConflict();
      case 'reused':
        this.securityLog.refreshTokenReused({
          userId: result.userId,
          sessionId: result.sessionId,
        });
        throw new InvalidRefresh('reused');
      case 'rotated':
        break;
    }

    const user = await this.accounts.getProfile(result.userId);
    if (!user) {
      await this.sessions.revokeSession(result.sessionId);
      throw new InvalidRefresh('session_missing');
    }
    const { accessToken, expiresIn } = await this.signer.sign({
      userId: result.userId,
      sessionId: result.sessionId,
    });
    return {
      accessToken,
      expiresIn,
      user,
      refreshToken: successor.token,
      refreshExpiresAt: result.refreshExpiresAt,
    };
  }
}
