import { createHash, randomBytes } from 'node:crypto';

// Refresh token opaco (D4 de auth-users): 32 bytes aleatorios en base64url. Solo `sha256(token)` llega a Mongo.

export interface GeneratedRefreshToken {
  /** Valor para la cookie `lv_refresh`. Nunca se guarda ni se registra. */
  readonly token: string;
  readonly tokenHash: string;
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashRefreshToken(token) };
}
