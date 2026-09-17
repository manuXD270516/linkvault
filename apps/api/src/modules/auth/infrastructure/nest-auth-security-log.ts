import { Logger } from '@nestjs/common';
import type {
  AuthSecurityLog,
  SessionEvent,
} from '../application/ports/auth-security-log.port';

/** Lo que el registro necesita de un logger; `Logger` de Nest lo cumple. */
export interface SecurityLogWriter {
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
}
