import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de 32 bytes en base64url; solo viaja en el correo / URL del SPA. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Hash SHA-256 hex del token en claro (misma familia que refresh, ADR-020/034). */
export function hashEmailToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
