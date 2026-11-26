import { Logger } from '@nestjs/common';
import type {
  AuthSecurityLog,
  ReissueEvent,
  SessionEvent,
} from '../application/ports/auth-security-log.port';

/** Lo que el registro necesita de un logger; `Logger` de Nest lo cumple. */
export interface SecurityLogWriter {
  log(message: string): void;
  warn(message: string): void;
}

/** Adaptador AUTH_SECURITY_LOG sobre el logger de Nest (pino en la app). Solo identificadores, nunca tokens. */
export class NestAuthSecurityLog implements AuthSecurityLog {
  constructor(
    private readonly writer: SecurityLogWriter = new Logger('AuthSecurity'),
  ) {}

  refreshTokenReused({ userId, sessionId }: SessionEvent): void {
    this.writer.warn(
      `Refresh token reuse detected, session revoked (userId=${userId}, sessionId=${sessionId})`,
    );
  }

  /** `info` la primera reemisión; `warn` desde la segunda, que en el patrón normal no debería darse (D7). */
  refreshTokenReissued({
    userId,
    sessionId,
    reissueCount,
  }: ReissueEvent): void {
    const message = `Refresh token reissued after a lost rotation response (userId=${userId}, sessionId=${sessionId}, reissueCount=${reissueCount})`;
    if (reissueCount >= 2) {
      this.writer.warn(message);
    } else {
      this.writer.log(message);
    }
  }
}
