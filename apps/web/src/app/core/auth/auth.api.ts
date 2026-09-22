import {
  HttpClient,
  HttpContext,
  HttpContextToken,
  HttpHeaders,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuthEmailAckResponse,
  ChangePasswordRequest,
  DeleteAccountRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  SessionResponse,
  UpdateProfileRequest,
  UserProfile,
  VerifyEmailRequest,
} from '@linkvault/shared';
import { Observable } from 'rxjs';
import { hasApiErrorCode } from '../api/api-error';
import {
  REFRESH_LOCKS,
  REFRESH_LOCK_NAME,
  REFRESH_RETRY_POLICY,
  abortReason,
  jitteredDelay,
  raceAbort,
} from './refresh-coordination';
import { SessionStore } from './session.store';

/**
 * Marca las peticiones que no deben llevar `Authorization: Bearer` ni disparar la renovación ante 401: login, registro,
 * refresh y logout (D11). El interceptor la consulta.
 */
export const SKIP_BEARER = new HttpContextToken<boolean>(() => false);

/** Cabecera anti-CSRF exigida por la API en todo `POST /api/auth/*` (D5). */
export const CSRF_HEADER_NAME = 'X-Requested-With';
export const CSRF_HEADER_VALUE = 'linkvault';

const AUTH_URL = '/api/auth';
const USERS_ME_URL = '/api/users/me';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);
  private readonly session = inject(SessionStore);
  private readonly locks = inject(REFRESH_LOCKS);
  private readonly retryPolicy = inject(REFRESH_RETRY_POLICY);
  private refreshInFlight: Promise<SessionResponse> | null = null;

  async register(body: RegisterRequest): Promise<SessionResponse> {
    const session = await this.send(
      this.http.post<SessionResponse>(`${AUTH_URL}/register`, body, authPostOptions(true)),
    );
    this.session.setSession(session);
    return session;
  }

  async login(body: LoginRequest): Promise<SessionResponse> {
    const session = await this.send(
      this.http.post<SessionResponse>(`${AUTH_URL}/login`, body, authPostOptions(true)),
    );
    this.session.setSession(session);
    return session;
  }

  /**
   * Renueva la sesión con la cookie de refresh (D11). Single-flight en la pestaña: las llamadas concurrentes comparten el
   * mismo intento. Entre pestañas se serializa con el lock `lv-refresh` de Web Locks (sin él, solo single-flight). Dentro
   * del lock, ante `409 refresh_conflict` reintenta con las esperas de `REFRESH_RETRY_POLICY` y, si se agotan, llama a
   * logout y rechaza con el último `409`.
   *
   * `signal` cancela la espera del lock, la petición en curso y los reintentos, y rechaza con `AbortError` sin llamar a
   * logout. Solo aborta el intento compartido la llamada que lo inició; quien se une deja de esperar sin cancelarlo.
   */
  refresh(signal?: AbortSignal): Promise<SessionResponse> {
    if (this.refreshInFlight) {
      return raceAbort(this.refreshInFlight, signal);
    }
    const flight = this.runRefresh(signal).finally(() => {
      if (this.refreshInFlight === flight) {
        this.refreshInFlight = null;
      }
    });
    this.refreshInFlight = flight;
    return flight;
  }

  /** Revoca la sesión en la API y borra la local aunque la llamada falle; el error se propaga al llamante. */
  async logout(): Promise<void> {
    try {
      await this.send(this.http.post<null>(`${AUTH_URL}/logout`, null, authPostOptions(true)));
    } finally {
      this.session.clear();
    }
  }

  /** `204` sin sesión nueva: el access token actual deja de valer y la petición siguiente renueva (D11). */
  async changePassword(body: ChangePasswordRequest): Promise<void> {
    await this.send(this.http.post<null>(`${AUTH_URL}/password`, body, authPostOptions(false)));
  }

  /**
   * Solicita el correo de recuperación. La API responde siempre `200` genérico (anti-enumeración); no inicia sesión.
   */
  async forgotPassword(body: ForgotPasswordRequest): Promise<AuthEmailAckResponse> {
    return this.send(
      this.http.post<AuthEmailAckResponse>(
        `${AUTH_URL}/forgot-password`,
        body,
        authPostOptions(true),
      ),
    );
  }

  /** Restablece la contraseña con el token del enlace. `204`; no inicia sesión. */
  async resetPassword(body: ResetPasswordRequest): Promise<void> {
    await this.send(
      this.http.post<null>(`${AUTH_URL}/reset-password`, body, authPostOptions(true)),
    );
  }

  /** Consume el token de verificación. `204`. Si hay sesión, el llamante debe refrescar el perfil. */
  async verifyEmail(body: VerifyEmailRequest): Promise<void> {
    await this.send(
      this.http.post<null>(`${AUTH_URL}/verify-email`, body, authPostOptions(true)),
    );
  }

  /**
   * Reenvía el correo de verificación para la sesión actual (cuerpo vacío). Siempre `200` genérico salvo 401/429.
   */
  async resendVerifyEmail(): Promise<AuthEmailAckResponse> {
    return this.send(
      this.http.post<AuthEmailAckResponse>(
        `${AUTH_URL}/verify-email/resend`,
        null,
        authPostOptions(false),
      ),
    );
  }

  async getProfile(): Promise<UserProfile> {
    const user = await this.send(this.http.get<UserProfile>(USERS_ME_URL));
    this.session.setUser(user);
    return user;
  }

  async updateProfile(body: UpdateProfileRequest): Promise<UserProfile> {
    const user = await this.send(this.http.patch<UserProfile>(USERS_ME_URL, body));
    this.session.setUser(user);
    return user;
  }

  /**
   * Borrado de cuenta (`DELETE /api/users/me`, spec users/account-deletion). Tras `204` limpia la sesión
   * local (el servidor ya invalidó refresh/sesiones); no llama a logout.
   */
  async deleteAccount(body: DeleteAccountRequest): Promise<void> {
    await this.send(this.http.delete<null>(USERS_ME_URL, { body }));
    this.session.clear();
  }

  private async runRefresh(signal?: AbortSignal): Promise<SessionResponse> {
    signal?.throwIfAborted();
    const session = this.locks
      ? await this.locks.request(REFRESH_LOCK_NAME, signal ? { signal } : {}, () =>
          this.refreshWithRetries(signal),
        )
      : await this.refreshWithRetries(signal);
    this.session.setSession(session);
    return session;
  }

  private async refreshWithRetries(signal?: AbortSignal): Promise<SessionResponse> {
    const { delaysMs, jitterRatio, random, sleep } = this.retryPolicy;
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      try {
        return await this.send(
          this.http.post<SessionResponse>(`${AUTH_URL}/refresh`, null, authPostOptions(true)),
          signal,
        );
      } catch (error: unknown) {
        if (!isRefreshConflict(error)) {
          throw error;
        }
        const baseDelay = delaysMs[attempt];
        if (baseDelay === undefined) {
          // Reintentos agotados: logout revoca la sesión aunque otro cliente haya rotado primero (ADR-020 §3).
          await this.logout().catch(() => undefined);
          throw error;
        }
        await sleep(jitteredDelay(baseDelay, jitterRatio, random()), signal);
      }
    }
  }

  /** Convierte la petición en promesa; si `signal` se aborta, cancela la petición y rechaza con su motivo. */
  private send<T>(request: Observable<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      let value: T;
      const onAbort = (): void => {
        subscription.unsubscribe();
        reject(abortReason(signal));
      };
      const subscription = request.subscribe({
        next: (next) => (value = next),
        error: (error: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
        complete: () => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
      });
      if (!subscription.closed) {
        signal?.addEventListener('abort', onAbort, { once: true });
      }
    });
  }
}

function authPostOptions(skipBearer: boolean): {
  headers: HttpHeaders;
  context: HttpContext;
} {
  return {
    headers: new HttpHeaders({ [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE }),
    context: new HttpContext().set(SKIP_BEARER, skipBearer),
  };
}

function isRefreshConflict(error: unknown): boolean {
  return hasApiErrorCode(error, 409, 'refresh_conflict');
}
