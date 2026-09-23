import { apiUrl } from './config';
import { CSRF_HEADER_VALUE, csrfHeaders } from './csrf';
import {
  createSingleFlight,
  refreshWithRetries,
  type RefreshRetryPolicy,
} from './refresh';
import {
  clearSession,
  readSession,
  writeSession,
  type ExtensionSession,
  type ExtensionUser,
} from './storage';
import { buildSaveLinkRequest, type SaveLinkOutcomeInput } from './save-link';

/** Respuesta de login/refresh de extensión (tokens en body; sin cookie). */
export interface ExtensionAuthResponse {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  user: ExtensionUser & Record<string, unknown>;
}

export interface GroupListItem {
  id: string;
  name: string;
}

export interface SaveLinkApiResponse extends SaveLinkOutcomeInput {
  created: boolean;
  link: { id: string };
}

export class ApiHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message?: string,
  ) {
    super(message ?? code ?? `HTTP ${status}`);
    this.name = 'ApiHttpError';
  }
}

export function isRefreshConflict(error: unknown): boolean {
  return error instanceof ApiHttpError && error.status === 409 && error.code === 'refresh_conflict';
}

export function sessionFromAuthResponse(
  body: ExtensionAuthResponse,
  nowMs: number = Date.now(),
): ExtensionSession {
  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    accessExpiresAt: nowMs + body.expiresIn * 1000,
    user: {
      id: body.user.id,
      email: body.user.email,
      displayName: body.user.displayName,
    },
  };
}

type FetchLike = typeof fetch;

export interface ExtensionApiDeps {
  fetch?: FetchLike;
  retryPolicy?: RefreshRetryPolicy;
}

/**
 * Cliente HTTP de la extensión. El refresh single-flight vive aquí (y solo se instancia en el
 * service worker) para que popup y background no disparen rotaciones concurrentes.
 */
export class ExtensionApi {
  private readonly fetchFn: FetchLike;
  private readonly runRefresh: () => Promise<ExtensionSession>;

  constructor(deps: ExtensionApiDeps = {}) {
    this.fetchFn = deps.fetch ?? fetch.bind(globalThis);
    this.runRefresh = createSingleFlight(() =>
      refreshWithRetries({
        refreshOnce: () => this.refreshOnce(),
        isConflict: isRefreshConflict,
        policy: deps.retryPolicy,
        onRetriesExhausted: () => clearSession(),
      }),
    );
  }

  async login(email: string, password: string): Promise<ExtensionSession> {
    const body = await this.postJson<ExtensionAuthResponse>(
      '/api/auth/extension/login',
      { email, password },
      { csrf: true },
    );
    const session = sessionFromAuthResponse(body);
    await writeSession(session);
    return session;
  }

  async logout(): Promise<void> {
    const session = await readSession();
    try {
      if (session !== null) {
        await this.postJson<null>(
          '/api/auth/extension/logout',
          { refreshToken: session.refreshToken },
          { csrf: true, acceptEmpty: true },
        );
      }
    } finally {
      await clearSession();
    }
  }

  /** Refresh single-flight + reintentos 409. */
  refresh(): Promise<ExtensionSession> {
    return this.runRefresh();
  }

  async listGroups(): Promise<GroupListItem[]> {
    const data = await this.authorizedJson<GroupListItem[]>('GET', '/api/groups');
    return data.map((group) => ({ id: group.id, name: group.name }));
  }

  async saveLink(url: string, groupId?: string | null): Promise<SaveLinkApiResponse> {
    const body = buildSaveLinkRequest(url, groupId);
    return this.authorizedJson<SaveLinkApiResponse>('POST', '/api/links', body);
  }

  private async refreshOnce(): Promise<ExtensionSession> {
    const session = await readSession();
    if (session === null) {
      throw new ApiHttpError(401, 'invalid_refresh', 'No session');
    }
    const body = await this.postJson<ExtensionAuthResponse>(
      '/api/auth/extension/refresh',
      { refreshToken: session.refreshToken },
      { csrf: true },
    );
    const next = sessionFromAuthResponse(body);
    await writeSession(next);
    return next;
  }

  private async authorizedJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const attempt = async (retried: boolean): Promise<T> => {
      const session = await readSession();
      if (session === null) {
        throw new ApiHttpError(401, 'unauthorized', 'Not signed in');
      }
      try {
        return await this.requestJson<T>(method, path, body, {
          authorization: `Bearer ${session.accessToken}`,
        });
      } catch (error: unknown) {
        if (
          !retried &&
          error instanceof ApiHttpError &&
          error.status === 401
        ) {
          await this.refresh();
          return attempt(true);
        }
        throw error;
      }
    };
    return attempt(false);
  }

  private async postJson<T>(
    path: string,
    body: unknown,
    options: { csrf: boolean; acceptEmpty?: boolean },
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.csrf) {
      Object.assign(headers, csrfHeaders());
    }
    return this.requestJson<T>('POST', path, body, {
      extraHeaders: headers,
      acceptEmpty: options.acceptEmpty,
    });
  }

  private async requestJson<T>(
    method: 'GET' | 'POST',
    path: string,
    body: unknown | undefined,
    options: {
      authorization?: string;
      extraHeaders?: Record<string, string>;
      acceptEmpty?: boolean;
    } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { ...(options.extraHeaders ?? {}) };
    if (options.authorization !== undefined) {
      headers['Authorization'] = options.authorization;
    }
    if (method === 'POST' && headers['Content-Type'] === undefined) {
      headers['Content-Type'] = 'application/json';
    }
    // Defensa en profundidad: toda ruta auth extensión lleva CSRF aunque el caller lo omita.
    if (path.includes('/api/auth/') && headers['X-Requested-With'] === undefined) {
      headers['X-Requested-With'] = CSRF_HEADER_VALUE;
    }

    const response = await this.fetchFn(apiUrl(path), {
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(body ?? null) : undefined,
    });

    if (response.status === 204 || options.acceptEmpty) {
      if (!response.ok && response.status !== 204) {
        throw await this.toError(response);
      }
      return undefined as T;
    }

    if (!response.ok) {
      throw await this.toError(response);
    }

    return (await response.json()) as T;
  }

  private async toError(response: Response): Promise<ApiHttpError> {
    let code: string | undefined;
    try {
      const payload = (await response.json()) as { code?: string };
      code = typeof payload.code === 'string' ? payload.code : undefined;
    } catch {
      code = undefined;
    }
    return new ApiHttpError(response.status, code);
  }
}
