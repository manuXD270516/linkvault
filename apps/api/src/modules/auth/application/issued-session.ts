import type { UserProfile } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
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
 * Lo que devuelve un use case que inicia o renueva sesión. El controlador responde `{ accessToken, expiresIn, user }`
 * y fija la cookie `lv_refresh` con `refreshToken` y `Max-Age` hasta `refreshExpiresAt`.
 */
export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly user: UserProfile;
  /** Valor en claro para la cookie. Nunca se registra ni se guarda. */
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

  async open(user: UserProfile): Promise<IssuedSession> {
    const refresh = generateRefreshToken();
    const opened = await this.sessions.open(user.id, refresh.tokenHash);
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
