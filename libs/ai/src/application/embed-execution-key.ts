import { createHash } from 'node:crypto';
import { EMBED_OPERATION } from '../domain/ports/embedding-provider.port';
import { canonicalJSON } from './canonical-json';

/** Clave de ledger para un lote de textos (antes de redactar). */
export function embedExecutionKey(texts: readonly string[]): string {
  return createHash('sha256')
    .update(canonicalJSON([EMBED_OPERATION, ...texts]), 'utf8')
    .digest('hex');
}
