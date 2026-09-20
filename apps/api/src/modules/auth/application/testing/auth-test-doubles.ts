import type { UserProfile } from '@linkvault/shared';
import { AI_CONSENT_TEXT_VERSION } from '@linkvault/shared';
import type { Clock } from '../../domain/clock';
import { EmailTaken, InvalidAccessToken } from '../../domain/errors';
import type { RefreshSessionPolicy } from '../../domain/refresh-session';
import type {
  AccessTokenSigner,
  AccessTokenSubject,
  SignedAccessToken,
  VerifiedAccessToken,
} from '../ports/access-token-signer.port';
import type {
  AuthSecurityLog,
  SessionEvent,
} from '../ports/auth-security-log.port';
import type { PasswordHasher } from '../ports/password-hasher.port';
import type {
  OpenedSession,
  RotateRefreshToken,
  RotationResult,
  SessionRepository,
  StoredRefreshToken,
} from '../ports/session-repository.port';
import type {
  AccountAuthState,
  AccountCredentials,
  NewAccount,
  UserAccounts,
} from '../ports/user-accounts.port';

// Dobles en memoria de los puertos de `auth` para tests de application (D12 de auth-users). No son adaptadores de
// producción: los reales viven en infrastructure.

export class MovableClock implements Clock {
  constructor(public current = new Date('2026-09-17T10:00:00.000Z')) {}

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

interface StoredAccount {
  profile: UserProfile;
  passwordHash: string;
  passwordChangedAt: Date;
}

/** Cuentas en memoria con las reglas del `UsersFacade`: email normalizado y único, perfil por defecto. */
export class InMemoryUserAccounts implements UserAccounts {
  private readonly accounts = new Map<string, StoredAccount>();
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  get size(): number {
    return this.accounts.size;
  }

  findCredentialsByEmail(email: string): Promise<AccountCredentials | null> {
    const account = this.byEmail(email);
    return Promise.resolve(
      account
        ? {
            userId: account.profile.id,
            email: account.profile.email,
            passwordHash: account.passwordHash,
          }
        : null,
    );
  }

  createWithPassword(input: NewAccount): Promise<UserProfile> {
    if (this.byEmail(input.email)) {
      return Promise.reject(new EmailTaken());
    }
    const now = this.clock.now();
    const profile: UserProfile = {
      id: `user-${this.nextId++}`,
      email: normalize(input.email),
      displayName: input.displayName.trim(),
      aiConsent: {
        externalProviders: false,
        consentedAt: null,
        textVersion: null,
        currentTextVersion: AI_CONSENT_TEXT_VERSION,
      },
      outputLanguage: 'es',
      redactName: true,
      createdAt: now.toISOString(),
    };
    this.accounts.set(profile.id, {
      profile,
      passwordHash: input.passwordHash,
      passwordChangedAt: now,
    });
    return Promise.resolve(structuredClone(profile));
  }

  setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const account = this.accounts.get(userId);
    if (!account) {
      return Promise.reject(new Error(`User "${userId}" not found`));
    }
    account.passwordHash = passwordHash;
    account.passwordChangedAt = this.clock.now();
    return Promise.resolve();
  }

  getAuthState(userId: string): Promise<AccountAuthState | null> {
    const account = this.accounts.get(userId);
    return Promise.resolve(
      account ? { userId, passwordChangedAt: account.passwordChangedAt } : null,
    );
  }

  getProfile(userId: string): Promise<UserProfile | null> {
    const account = this.accounts.get(userId);
    return Promise.resolve(account ? structuredClone(account.profile) : null);
  }

  /** Hash guardado, para comprobar que un cambio fallido no lo toca. */
  passwordHashOf(userId: string): string | undefined {
    return this.accounts.get(userId)?.passwordHash;
  }

  private byEmail(email: string): StoredAccount | undefined {
    const normalized = normalize(email);
    return [...this.accounts.values()].find(
      (account) => account.profile.email === normalized,
    );
  }
}

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** Hasher trivial que cuenta verificaciones reales y ficticias. */
export class FakePasswordHasher implements PasswordHasher {
  hashes = 0;
  verifications = 0;
  dummyVerifications = 0;

  hash(password: string): Promise<string> {
    this.hashes++;
    return Promise.resolve(`fake-argon2id$${password}`);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    this.verifications++;
    return Promise.resolve(passwordHash === `fake-argon2id$${password}`);
  }

  verifyDummy(): Promise<void> {
    this.dummyVerifications++;
    return Promise.resolve();
  }

  /** Verificaciones de cualquier tipo: lo que el spec llama "verificar un hash". */
  get anyVerifications(): number {
    return this.verifications + this.dummyVerifications;
  }
}

/** Firmador legible: `access.<userId>.<sessionId>.<iat>`. */
export class FakeAccessTokenSigner implements AccessTokenSigner {
  constructor(
    private readonly clock: Clock,
    private readonly ttlSeconds = 900,
  ) {}

  sign(subject: AccessTokenSubject): Promise<SignedAccessToken> {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    return Promise.resolve({
      accessToken: `access.${subject.userId}.${subject.sessionId}.${iat}`,
      expiresIn: this.ttlSeconds,
    });
  }

  verify(accessToken: string): Promise<VerifiedAccessToken> {
    const [prefix, userId, sessionId, iat] = accessToken.split('.');
    if (prefix !== 'access' || !userId || !sessionId || !iat) {
      return Promise.reject(new InvalidAccessToken());
    }
    return Promise.resolve({
      userId,
      sessionId,
      issuedAtSeconds: Number(iat),
    });
  }
}

interface StoredSession {
  readonly userId: string;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  revokedAt: Date | null;
}

type MutableToken = {
  -readonly [K in keyof StoredRefreshToken]: StoredRefreshToken[K];
};

/** Sesiones en memoria con las mismas reglas que `MongoSessionRepository` (sin concurrencia real). */
export class InMemorySessionRepository implements SessionRepository {
  readonly sessions = new Map<string, StoredSession>();
  readonly tokens = new Map<string, MutableToken>();
  /** Si se fija, `open` rechaza con este error. */
  failOpenWith: Error | null = null;
  /** Si se fija, las revocaciones rechazan con este error. */
  failRevokeWith: Error | null = null;
  private nextId = 1;

  constructor(
    private readonly policy: RefreshSessionPolicy,
    private readonly clock: Clock,
  ) {}

  open(userId: string, refreshTokenHash: string): Promise<OpenedSession> {
    if (this.failOpenWith) {
      return Promise.reject(this.failOpenWith);
    }
    const window = this.policy.openSession();
    const sessionId = `session-${this.nextId++}`;
    this.sessions.set(sessionId, {
      userId,
      createdAt: window.createdAt,
      expiresAt: window.expiresAt,
      revokedAt: null,
    });
    this.tokens.set(refreshTokenHash, {
      tokenHash: refreshTokenHash,
      sessionId,
      userId,
      createdAt: window.createdAt,
      expiresAt: window.refreshExpiresAt,
      rotatedAt: null,
      replacedByHash: null,
    });
    return Promise.resolve({
      sessionId,
      userId,
      expiresAt: window.expiresAt,
      refreshExpiresAt: window.refreshExpiresAt,
    });
  }

  findRefreshToken(tokenHash: string): Promise<StoredRefreshToken | null> {
    const token = this.tokens.get(tokenHash);
    return Promise.resolve(token ? { ...token } : null);
  }

  revokeSession(sessionId: string): Promise<void> {
    if (this.failRevokeWith) {
      return Promise.reject(this.failRevokeWith);
    }
    const session = this.sessions.get(sessionId);
    if (session && session.revokedAt === null) {
      session.revokedAt = this.clock.now();
    }
    return Promise.resolve();
  }

  revokeUserSessionsExcept(
    userId: string,
    keepSessionId: string,
  ): Promise<number> {
    if (this.failRevokeWith) {
      return Promise.reject(this.failRevokeWith);
    }
    let revoked = 0;
    for (const [sessionId, session] of this.sessions) {
      if (
        session.userId === userId &&
        sessionId !== keepSessionId &&
        session.revokedAt === null
      ) {
        session.revokedAt = this.clock.now();
        revoked++;
      }
    }
    return Promise.resolve(revoked);
  }

  rotate({
    tokenHash,
    successorHash,
  }: RotateRefreshToken): Promise<RotationResult> {
    const token = this.tokens.get(tokenHash);
    if (!token) {
      return Promise.resolve({ outcome: 'invalid', reason: 'unknown_token' });
    }
    const session = this.sessions.get(token.sessionId) ?? null;
    const identity = { sessionId: token.sessionId, userId: token.userId };
    const decision = this.policy.decide(token, session);
    switch (decision.outcome) {
      case 'invalid':
        return Promise.resolve(decision);
      case 'conflict':
        return Promise.resolve({ outcome: 'conflict', ...identity });
      case 'reuse':
        if (session && session.revokedAt === null) {
          session.revokedAt = this.clock.now();
        }
        return Promise.resolve({ outcome: 'reused', ...identity });
      case 'rotate':
        token.rotatedAt = decision.now;
        token.replacedByHash = successorHash;
        this.tokens.set(successorHash, {
          tokenHash: successorHash,
          ...identity,
          createdAt: decision.now,
          expiresAt: decision.successorExpiresAt,
          rotatedAt: null,
          replacedByHash: null,
        });
        return Promise.resolve({
          outcome: 'rotated',
          ...identity,
          refreshExpiresAt: decision.successorExpiresAt,
        });
    }
  }

  /** `true` si la sesión existe y no está revocada. */
  isActive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.revokedAt === null;
  }
}

/** Registro de eventos de seguridad en memoria. */
export class RecordingSecurityLog implements AuthSecurityLog {
  readonly reusedTokens: SessionEvent[] = [];

  refreshTokenReused(event: SessionEvent): void {
    this.reusedTokens.push(event);
  }
}
