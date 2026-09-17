import { HOME_ROUTE } from '../navigation/home-route';

/**
 * Devuelve `returnUrl` solo si es una ruta interna: empieza por `/`, no por `//` ni `/\` (que el navegador trata como
 * otro origen) y no contiene caracteres de control (que el navegador elimina, p. ej. `/\t/evil.example`). Si no, el
 * inicio (`HOME_ROUTE`).
 */
export function safeReturnUrl(returnUrl: string | null | undefined): string {
  if (!returnUrl || !returnUrl.startsWith('/')) {
    return HOME_ROUTE;
  }
  if (returnUrl.startsWith('//') || returnUrl.startsWith('/\\')) {
    return HOME_ROUTE;
  }
  for (let index = 0; index < returnUrl.length; index++) {
    const code = returnUrl.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return HOME_ROUTE;
    }
  }
  return returnUrl;
}
