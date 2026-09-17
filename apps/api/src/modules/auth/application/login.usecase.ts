import { Inject, Injectable } from '@nestjs/common';
import {
  LOGIN_ATTEMPTS_PER_EMAIL,
  LOGIN_ATTEMPTS_PER_IP,
} from '../domain/attempt-limits';
import { InvalidCredentials, TooManyAttempts } from '../domain/errors';
import { type IssuedSession, SessionOpener } from './issued-session';
import {
  ATTEMPT_LIMITER,
  type AttemptLimiter,
} from './ports/attempt-limiter.port';
import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from './ports/password-hasher.port';
import { USER_ACCOUNTS, type UserAccounts } from './ports/user-accounts.port';

export interface LoginInput {
  /** Tal como llega; se normaliza. */
  readonly email: string;
  readonly password: string;
  /** IP del cliente (`request.ip`). */
  readonly ip: string;
}

/**
 * `POST /api/auth/login` (spec auth/credentials). Cuenta el intento por email normalizado y por IP **antes** de verificar;
 * superado cualquiera de los dos límites responde `too_many_attempts` sin verificar. Email inexistente y contraseña
 * incorrecta dan el mismo `InvalidCredentials` y ambos verifican un hash Argon2id. Un login correcto reinicia el contador
 * del email y descuenta el intento de la IP.
 */
@Injectable()
export class Login {
  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    private readonly sessionOpener: SessionOpener,
  ) {}

  async execute(input: LoginInput): Promise<IssuedSession> {
    const email = input.email.trim().toLowerCase();
    const byEmail = await this.limiter.consume(
      { kind: 'login-email', email },
      LOGIN_ATTEMPTS_PER_EMAIL,
    );
    const byIp = await this.limiter.consume(
      { kind: 'login-ip', ip: input.ip },
      LOGIN_ATTEMPTS_PER_IP,
    );
    if (!byEmail.allowed || !byIp.allowed) {
      throw new TooManyAttempts(
        Math.max(byEmail.retryAfterSeconds, byIp.retryAfterSeconds),
      );
    }

    const credentials = await this.accounts.findCredentialsByEmail(email);
    if (!credentials) {
      await this.hasher.verifyDummy(input.password);
      throw new InvalidCredentials();
    }
    if (!(await this.hasher.verify(credentials.passwordHash, input.password))) {
      throw new InvalidCredentials();
    }

    await this.limiter.recordLoginSuccess(email, input.ip);
    const user = await this.accounts.getProfile(credentials.userId);
    if (!user) {
      // La cuenta desapareció entre la verificación y la sesión: se trata como credenciales inválidas.
      throw new InvalidCredentials();
    }
    return this.sessionOpener.open(user);
  }
}
