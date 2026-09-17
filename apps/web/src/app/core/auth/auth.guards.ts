import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { HOME_ROUTE } from '../navigation/home-route';
import { SessionRestore } from './session-restore';
import { SessionStore } from './session.store';

/** Exige sesión; sin ella redirige a `/login` recordando la ruta pedida (salvo el inicio). */
export const authGuard: CanActivateFn = async (_route, state) => {
  const router = inject(Router);
  const store = inject(SessionStore);
  await inject(SessionRestore).restore();
  if (store.isAuthenticated()) {
    return true;
  }
  return router.createUrlTree(['/login'], {
    queryParams: state.url === HOME_ROUTE ? {} : { returnUrl: state.url },
  });
};

/** Páginas de invitado (`/login`, `/registro`): con sesión redirige al inicio. */
export const guestGuard: CanActivateFn = async () => {
  const router = inject(Router);
  const store = inject(SessionStore);
  await inject(SessionRestore).restore();
  return store.isAuthenticated() ? router.createUrlTree([HOME_ROUTE]) : true;
};
