import type { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { hasApiErrorCode } from '../api/api-error';
import { AuthApi, SKIP_BEARER } from './auth.api';
import { SessionStore } from './session.store';

/**
 * Adjunta `Authorization: Bearer` a las peticiones a `/api` salvo las marcadas con `SKIP_BEARER` (login, registro,
 * refresh y logout). Solo ante `401 unauthorized` espera el refresh compartido y repite la petición una vez con el token
 * nuevo; si el refresh falla, borra la sesión local y navega a `/login` recordando la ruta actual (D11).
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isApiRequest(request) || request.context.get(SKIP_BEARER)) {
    return next(request);
  }
  const store = inject(SessionStore);
  const authApi = inject(AuthApi);
  const router = inject(Router);

  return next(withBearer(request, store.accessToken())).pipe(
    catchError((error: unknown) => {
      if (!hasApiErrorCode(error, 401, 'unauthorized')) {
        return throwError(() => error);
      }
      return from(authApi.refresh()).pipe(
        // Solo captura el fallo del refresh: el error de la petición repetida llega tal cual, sin renovar otra vez.
        catchError(() => {
          store.clear();
          void router.navigate(['/login'], {
            queryParams: router.url === '/' ? {} : { returnUrl: router.url },
          });
          return throwError(() => error);
        }),
        switchMap((session) => next(withBearer(request, session.accessToken))),
      );
    }),
  );
};

function withBearer(
  request: HttpRequest<unknown>,
  accessToken: string | null,
): HttpRequest<unknown> {
  return accessToken
    ? request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } })
    : request;
}

function isApiRequest(request: HttpRequest<unknown>): boolean {
  return request.url === '/api' || request.url.startsWith('/api/');
}
