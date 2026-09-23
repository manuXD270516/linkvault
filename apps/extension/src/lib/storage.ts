/** Perfil mínimo que persiste la extensión tras login/refresh. */
export interface ExtensionUser {
  id: string;
  email: string;
  displayName: string;
}

/** Sesión de extensión en `chrome.storage.local` (ADR-038). */
export interface ExtensionSession {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms en que caduca el access (aprox. desde `expiresIn`). */
  accessExpiresAt: number;
  user: ExtensionUser;
}

const ACCESS_TOKEN_KEY = 'lv_ext_access_token';
const REFRESH_TOKEN_KEY = 'lv_ext_refresh_token';
const ACCESS_EXPIRES_AT_KEY = 'lv_ext_access_expires_at';
const USER_KEY = 'lv_ext_user';

export async function readSession(): Promise<ExtensionSession | null> {
  const data = await chrome.storage.local.get([
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    ACCESS_EXPIRES_AT_KEY,
    USER_KEY,
  ]);
  const accessToken = asString(data[ACCESS_TOKEN_KEY]);
  const refreshToken = asString(data[REFRESH_TOKEN_KEY]);
  const accessExpiresAt = asNumber(data[ACCESS_EXPIRES_AT_KEY]);
  const user = asUser(data[USER_KEY]);
  if (
    accessToken === null ||
    refreshToken === null ||
    accessExpiresAt === null ||
    user === null
  ) {
    return null;
  }
  return { accessToken, refreshToken, accessExpiresAt, user };
}

export async function writeSession(session: ExtensionSession): Promise<void> {
  await chrome.storage.local.set({
    [ACCESS_TOKEN_KEY]: session.accessToken,
    [REFRESH_TOKEN_KEY]: session.refreshToken,
    [ACCESS_EXPIRES_AT_KEY]: session.accessExpiresAt,
    [USER_KEY]: session.user,
  });
}

export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove([
    ACCESS_TOKEN_KEY,
    REFRESH_TOKEN_KEY,
    ACCESS_EXPIRES_AT_KEY,
    USER_KEY,
  ]);
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asUser(value: unknown): ExtensionUser | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = asString(record['id']);
  const email = asString(record['email']);
  const displayName = asString(record['displayName']);
  if (id === null || email === null || displayName === null) {
    return null;
  }
  return { id, email, displayName };
}
