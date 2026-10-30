/**
 * Servicios push conocidos (change `enrichment-egress-guard`, D7). El endpoint push lo genera el navegador y siempre
 * es de su servicio push; el servidor solo envía a esta lista. La lista es código, no configuración: ampliarla es un
 * cambio pequeño y revisado.
 */
export const KNOWN_PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome y derivados de Chromium
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari
  'notify.windows.com', // Edge
] as const;

const HOST_CHARACTERS = /^[a-z0-9.-]+$/;

/** Espacios, caracteres de control y barra invertida: lo que los dos analizadores de URL leen de forma distinta. */
function hasForbiddenCharacters(raw: string): boolean {
  for (const character of raw) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return true;
  }
  return false;
}

/**
 * Si el texto crudo es el endpoint de un servicio push conocido, con **un solo criterio** para los dos analizadores
 * implicados (WHATWG en el alta; el heredado de Node en la librería de envío): sin espacios, controles ni barra
 * invertida; ya en forma canónica (`new URL(raw).href === raw`, así que tampoco lleva puerto explícito ni mayúsculas);
 * host solo con letras ASCII, dígitos, guiones y puntos; `https`, sin credenciales y puerto por defecto; host igual a
 * un servicio o terminado en `.` + el servicio.
 */
export function isKnownPushEndpoint(raw: string): boolean {
  if (hasForbiddenCharacters(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.href !== raw) return false;
  if (url.protocol !== 'https:') return false;
  if (url.username !== '' || url.password !== '' || url.port !== '') {
    return false;
  }
  if (!HOST_CHARACTERS.test(url.hostname)) return false;
  return KNOWN_PUSH_SERVICE_HOSTS.some(
    (service) =>
      url.hostname === service || url.hostname.endsWith(`.${service}`),
  );
}
