import type { Params, Router } from '@angular/router';

/** Query params que conservan la ruta pedida en los enlaces entre `/login` y `/registro` (solo si no es `/`). */
export function returnUrlQueryParams(returnUrl: string): Params {
  return returnUrl === '/' ? {} : { returnUrl };
}

/** Email recibido en el `state` de la navegación en curso (nunca en la URL); cadena vacía si no hay. */
export function navigationStateEmail(router: Router): string {
  const email: unknown = router.currentNavigation()?.extras.state?.['email'];
  return typeof email === 'string' ? email : '';
}
