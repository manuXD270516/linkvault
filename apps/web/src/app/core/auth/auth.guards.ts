import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { SessionRestore } from './session-restore';
import { SessionStore } from './session.store';

/** Exige sesión; sin ella redirige a `/login` recordando la ruta pedida (salvo `/`). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const store = inject(SessionStore);
  await inject(SessionRestore).restore();
  if (store.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login'], {
    queryParams: state.url === '/' ? {} : { returnUrl: state.url },
  });
};

/** Páginas de invitado (`/login`, `/registro`): con sesión redirige a `/`. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const store = inject(SessionStore);
  await inject(SessionRestore).restore();
  return store.isAuthenticated() ? router.createUrlTree(['/']) : true;
};
