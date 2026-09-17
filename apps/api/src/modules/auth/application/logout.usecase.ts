import { Inject, Injectable } from '@nestjs/common';
import {
  SESSION_REPOSITORY,
  type SessionRepository,
} from './ports/session-repository.port';
import { hashRefreshToken } from './refresh-token';

export interface LogoutInput {
  /** Valor de la cookie `lv_refresh`, si llegó. */
  readonly refreshToken?: string;
}

/**
 * `POST /api/auth/logout` (spec auth/sessions). Revoca la sesión del refresh token de la cookie, también si ya se rotó:
 * así el cliente legítimo que agota sus reintentos ante 409 cierra una sesión que un tercero pudo rotar (D4). Sin cookie
 * o con un token desconocido no hace nada; el controlador responde 204 y borra la cookie en todos los casos.
 */
@Injectable()
export class Logout {
  constructor(
    @Inject(SESSION_REPOSITORY) private readonly sessions: SessionRepository,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    if (!input.refreshToken) {
      return;
    }
    const token = await this.sessions.findRefreshToken(
      hashRefreshToken(input.refreshToken),
    );
    if (token) {
      await this.sessions.revokeSession(token.sessionId);
    }
  }
}
