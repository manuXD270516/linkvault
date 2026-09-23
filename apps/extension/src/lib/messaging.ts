/** Mensajes del popup ↔ service worker. El refresh solo corre en el SW (single-flight). */
export type ExtensionMessage =
  | { type: 'GET_SESSION' }
  | { type: 'LOGIN'; email: string; password: string }
  | { type: 'LOGOUT' }
  | { type: 'REFRESH' }
  | { type: 'LIST_GROUPS' }
  | { type: 'SAVE_LINK'; url: string; groupId?: string | null };

export type ExtensionMessageResult =
  | { ok: true; data?: unknown }
  | { ok: false; error: { status?: number; code?: string; message: string } };
