import type { Params, Router } from '@angular/router';
import { HOME_ROUTE } from '../../core/navigation/home-route';

/**
 * Query params que conservan, en los enlaces entre `/login` y `/registro`, la ruta pedida (solo si no es el inicio) y
 * el `import` con el que se llegó desde una oferta pública. Sin conservar el `import`, ir del registro al login
 * perdería la oferta, y volver a por ella exige salir del SPA y buscar el mensaje en el chat.
 */
export function authLinkQueryParams(returnUrl: string, importSlug: string | null): Params {
  return {
    ...(returnUrl === HOME_ROUTE ? {} : { returnUrl }),
    ...(importSlug === null ? {} : { import: importSlug }),
  };
}

/**
 * Adónde navegar tras entrar o registrarse. **Gana el `import`** sobre la ruta pedida (critic 16): es el gesto más
 * reciente y el explícito —pulsó "Guardar en LinkVault", no "llévame a mi perfil"—, y perder la oferta es irreversible
 * desde el SPA, mientras que la ruta pedida está a un clic. Un `import` que no tiene forma de slug ya llega aquí como
 * `null` y se ignora, igual que `safeReturnUrl` ignora una ruta de retorno ajena.
 */
export function afterAuthUrl(importSlug: string | null, returnUrl: string): string {
  return importSlug === null
    ? returnUrl
    : `/mis-links?import=${encodeURIComponent(importSlug)}`;
}

/** Email recibido en el `state` de la navegación en curso (nunca en la URL); cadena vacía si no hay. */
export function navigationStateEmail(router: Router): string {
  const email: unknown = router.currentNavigation()?.extras.state?.['email'];
  return typeof email === 'string' ? email : '';
}
