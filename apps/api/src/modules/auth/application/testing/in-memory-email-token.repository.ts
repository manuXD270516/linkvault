import type {
  EmailTokenConsumeEffect,
  EmailTokenPurpose,
  EmailTokenRepository,
  IssueEmailToken,
  IssuedEmailToken,
  ValidEmailToken,
} from '../ports/email-token-repository.port';
import type { Clock } from '../../domain/clock';

type StoredToken = {
  id: string;
  userId: string;
  purpose: EmailTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
};

/**
 * Repositorio en memoria de tokens de email para tests de application.
 * `failIssueWith` simula fallo de persistencia tras el registro.
 */
export class InMemoryEmailTokenRepository implements EmailTokenRepository {
  readonly tokens = new Map<string, StoredToken>();
  failIssueWith: Error | null = null;
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  issue(input: IssueEmailToken): Promise<IssuedEmailToken> {
    if (this.failIssueWith) {
      return Promise.reject(this.failIssueWith);
    }
    for (const token of this.tokens.values()) {
      if (
        token.userId === input.userId &&
        token.purpose === input.purpose &&
        token.usedAt === null
      ) {
        token.usedAt = this.clock.now();
      }
    }
    const id = `email-token-${this.nextId++}`;
    const createdAt = this.clock.now();
    this.tokens.set(id, {
      id,
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: input.tokenHash,
      expiresAt: new Date(input.expiresAt),
      createdAt,
      usedAt: null,
    });
    return Promise.resolve({
      id,
      userId: input.userId,
      purpose: input.purpose,
      expiresAt: new Date(input.expiresAt),
      createdAt,
    });
  }

  findValid(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
  ): Promise<ValidEmailToken | null> {
    const token = [...this.tokens.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash && candidate.purpose === purpose,
    );
    if (
      !token ||
      token.usedAt !== null ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return Promise.resolve(null);
    }
    return Promise.resolve({
      userId: token.userId,
      purpose: token.purpose,
      expiresAt: token.expiresAt,
    });
  }

  async consume(
    tokenHash: string,
    purpose: EmailTokenPurpose,
    now: Date,
    effect: EmailTokenConsumeEffect,
  ): Promise<'consumed' | 'invalid'> {
    const token = [...this.tokens.values()].find(
      (candidate) =>
        candidate.tokenHash === tokenHash && candidate.purpose === purpose,
    );
    if (
      !token ||
      token.usedAt !== null ||
      token.expiresAt.getTime() <= now.getTime()
    ) {
      return 'invalid';
    }
    await effect(token.userId, undefined);
    token.usedAt = new Date(now);
    return 'consumed';
  }

  deleteAllForUser(userId: string, _session?: object): Promise<number> {
    let deleted = 0;
    for (const [id, token] of this.tokens) {
      if (token.userId === userId) {
        this.tokens.delete(id);
        deleted++;
      }
    }
    return Promise.resolve(deleted);
  }

  /** ¿Existe el hash en claro hasheado? (tests de persistencia sin claro). */
  hasHash(tokenHash: string): boolean {
    return [...this.tokens.values()].some(
      (token) => token.tokenHash === tokenHash,
    );
  }

  /** ¿Contiene el valor en claro? Nunca debería. */
  containsPlain(plain: string): boolean {
    return JSON.stringify([...this.tokens.values()]).includes(plain);
  }
}
