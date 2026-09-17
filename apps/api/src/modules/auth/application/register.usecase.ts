import { Inject, Injectable } from '@nestjs/common';
import { REGISTRATIONS_PER_IP } from '../domain/attempt-limits';
import { TooManyAttempts } from '../domain/errors';
import { assertPasswordPolicy } from '../domain/password-policy';
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

export interface RegisterInput {
  /** Tal como llega; se normaliza al guardarlo. */
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  /** IP del cliente (`request.ip`). */
  readonly ip: string;
}

/**
 * `POST /api/auth/register` (spec auth/credentials). Cuenta el intento por IP, aplica la política, crea el usuario con el
 * perfil por defecto en una escritura y abre la sesión en otra. Si la sesión falla, el error se propaga (500) y el usuario
 * ya existe: un reintento recibe `email_taken` y un login funciona (D1).
 */
@Injectable()
export class Register {
  constructor(
    @Inject(USER_ACCOUNTS) private readonly accounts: UserAccounts,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ATTEMPT_LIMITER) private readonly limiter: AttemptLimiter,
    private readonly sessionOpener: SessionOpener,
  ) {}

  async execute(input: RegisterInput): Promise<IssuedSession> {
    const attempt = await this.limiter.consume(
      { kind: 'register-ip', ip: input.ip },
      REGISTRATIONS_PER_IP,
    );
    if (!attempt.allowed) {
      throw new TooManyAttempts(attempt.retryAfterSeconds);
    }

    assertPasswordPolicy({
      password: input.password,
      email: input.email,
      field: 'password',
    });
    const user = await this.accounts.createWithPassword({
      email: input.email,
      passwordHash: await this.hasher.hash(input.password),
      displayName: input.displayName,
    });
    return this.sessionOpener.open(user);
  }
}
