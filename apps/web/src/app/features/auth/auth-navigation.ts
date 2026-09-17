import type { Params, Router } from '@angular/router';
import { HOME_ROUTE } from '../../core/navigation/home-route';

/** Query params que conservan la ruta pedida en los enlaces entre `/login` y `/registro` (solo si no es el inicio). */
export function returnUrlQueryParams(returnUrl: string): Params {
  return returnUrl === HOME_ROUTE ? {} : { returnUrl };
}

/** Email recibido en el `state` de la navegación en curso (nunca en la URL); cadena vacía si no hay. */
export function navigationStateEmail(router: Router): string {
  const email: unknown = router.currentNavigation()?.extras.state?.['email'];
  return typeof email === 'string' ? email : '';
}
