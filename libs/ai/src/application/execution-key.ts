import { createHash } from 'node:crypto';
import type { OutputLanguage } from '../domain/run-context';
import { canonicalJSON } from './canonical-json';

// Clave de ejecución (D4 de ai-gateway-core, ADR-018 §3): identifica caché, fixtures del mock e `inputHash` del ledger.
// Se calcula sobre el input ya parseado por zod y antes de la redacción. No depende del texto del prompt.

export interface ExecutionIdentity {
  taskName: string;
  promptVersion: string;
  outputLanguage: OutputLanguage;
  /** Input validado por `inputSchema`. */
  input: unknown;
}

/** sha256(canonicalJSON([taskName, promptVersion, outputLanguage, parsedInput])) en hexadecimal. */
export function executionKey(identity: ExecutionIdentity): string {
  const tuple = [
    identity.taskName,
    identity.promptVersion,
    identity.outputLanguage,
    identity.input,
  ];
  return createHash('sha256')
    .update(canonicalJSON(tuple), 'utf8')
    .digest('hex');
}
