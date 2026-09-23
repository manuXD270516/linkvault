import type { UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { SessionClient } from '../domain/session-client';
import {
  ACCESS_TOKEN_SIGNER,
  type AccessTokenSigner,
} from './ports/access-token-signer.port';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.port';
import { generateRefreshToken } from './refresh-token';

/**
 * Lo que devuelve un use case que inicia o renueva sesión. El controlador web responde
 * `{ accessToken, expiresIn, user }` y fija la cookie `lv_refresh`; el de extensión incluye
 * `refreshToken` en el cuerpo y no toca cookies (ADR-038).
 */
export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly user: UserProfile;
  /** Valor en claro (cookie web o cuerpo extensión). Nunca se registra ni se guarda. */
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/** Abre una sesión nueva para un usuario ya autenticado (registro y login): primer refresh token y access token. */
@Injectable()
export class SessionOpener {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
    @Inject(ACCESS_TOKEN_SIGNER) private readonly signer: AccessTokenSigner,
  ) {}

  async open(
    user: UserProfile,
    client: SessionClient = 'web',
  ): Promise<IssuedSession> {
    const refresh = generateRefreshToken();
    const opened = await this.sessions.open(user.id, refresh.tokenHash, client);
    const { accessToken, expiresIn } = await this.signer.sign({
      userId: user.id,
      sessionId: opened.sessionId,
    });
    return {
      accessToken,
      expiresIn,
      user,
      refreshToken: refresh.token,
      refreshExpiresAt: opened.refreshExpiresAt,
    };
  }
}
