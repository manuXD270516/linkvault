import {
  commentTextLength,
  normalizeCommentText,
  SHARE_NOTE_MAX_LENGTH,
} from '@linkvault/shared';
import { InvalidShareNote } from './errors';
import type { CommentRequesterRole } from './group-link-comment';

// Nota de quien comparte un link en un grupo (D3 de group-comments): una por relación, escrita solo al crearla, que no
// se edita y que pueden quitar quien compartió y el `owner`. Se normaliza igual que un comentario (D5).

export interface ShareNote {
  /** Normalizada y de 1 a 280 code points. */
  readonly text: string;
  /** La nota no se edita, así que su única fecha es la de creación. */
  readonly createdAt: Date;
}

/**
 * Nota lista para guardar, o `null` si queda vacía tras normalizarse: una nota vacía equivale a no enviarla.
 * `InvalidShareNote` si pasa de 280 code points.
 */
export function createShareNote(
  text: string | undefined,
  now: Date,
): ShareNote | null {
  if (text === undefined) {
    return null;
  }
  const normalized = normalizeCommentText(text);
  const length = commentTextLength(normalized);
  if (length === 0) {
    return null;
  }
  if (length > SHARE_NOTE_MAX_LENGTH) {
    throw new InvalidShareNote();
  }
  return { text: normalized, createdAt: now };
}

/** `true` si quien pide puede quitar la nota: quien compartió el link o el `owner` del grupo, haya o no nota. */
export function mayRemoveNote(
  sharedBy: string,
  requesterId: string,
  role: CommentRequesterRole,
): boolean {
  return sharedBy === requesterId || role === 'owner';
}
