import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';
import { HOME_ROUTE } from '../navigation/home-route';
import { importSlug } from '../public/import-slug';
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

/**
 * Páginas de invitado estricto (`/login`, `/registro`): con sesión redirige al inicio, salvo cuando llevan un `import`
 * con forma de slug, que lleva a `/mis-links?import=<slug>` (D9 de public-preview-share).
 *
 * No aplica a `/recuperar-contrasena`, `/restablecer-contrasena` ni `/verificar-email`: esas rutas son de invitado
 * ampliadas (spec web/auth) y deben permanecer usables con sesión sin forzar redirección a `/grupos`.
 *
 * Aquí es donde se resuelve la sesión de quien pulsa "Guardar en LinkVault" en una oferta pública: el CTA navega
 * siempre a `/registro?import=<slug>` sin preguntar nada, y quien ya tiene cuenta no llega a ver el registro.
 */
export const guestGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const store = inject(SessionStore);
  await inject(SessionRestore).restore();
  if (!store.isAuthenticated()) {
    return true;
  }
  const slug = importSlug(route.queryParamMap.get('import'));
  return slug === null
    ? router.createUrlTree([HOME_ROUTE])
    : router.createUrlTree(['/mis-links'], { queryParams: { import: slug } });
};
