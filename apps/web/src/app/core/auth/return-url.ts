/**
 * Devuelve `returnUrl` solo si es una ruta interna: empieza por `/`, no por `//` ni `/\` (que el navegador trata como
 * otro origen) y no contiene caracteres de control (que el navegador elimina, p. ej. `/\t/evil.example`). Si no, `/`.
 */
export function safeReturnUrl(returnUrl: string | null | undefined): string {
  if (!returnUrl || !returnUrl.startsWith('/')) {
    return '/';
  }
  if (returnUrl.startsWith('//') || returnUrl.startsWith('/\\')) {
    return '/';
  }
  for (let index = 0; index < returnUrl.length; index++) {
    const code = returnUrl.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return '/';
    }
  }
  return returnUrl;
}
