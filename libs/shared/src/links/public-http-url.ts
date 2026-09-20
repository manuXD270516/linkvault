import { isCampaignParam } from './campaign-params';

// Saneado de la URL que se publica (D6 de public-preview-share, ADR-027 §3). NO toca el `displayUrl` guardado, que es
// inmutable a propósito (ADR-021): esto es solo lo que sale en la página pública y en el endpoint público.
//
// El `displayUrl` es la URL tal y como la escribió una persona y nunca se normalizó, así que puede llevar credenciales
// embebidas —`https://ana:secreto@bolsa.example/…`— y, sobre todo, parámetros de seguimiento: una URL copiada del correo
// de una bolsa arrastra `utm_*`, `mc_cid` o `mc_eid`, y un `mc_eid` es un identificador de suscriptor que a veces lleva
// el email dentro. Publicarla tal cual sería repartir el rastro de quien recibió esa oferta.

/** Esquemas que se pueden publicar. Un `javascript:` o un `ftp:` no se publican, y la página va sin enlace. */
const PUBLISHABLE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * URL publicable, o `null` si el esquema no es `http(s)`, no tiene host o no es una URL. Quita `username`, `password` y
 * los parámetros de campaña de la lista cerrada, y **conserva el fragmento**: hay bolsas que ponen la ruta de la oferta
 * en el `#`, y quitarlo manda a la portada, es decir, rompe el enlace, que es lo único que la página pública promete.
 * Lo que el fragmento podría filtrar —el slug en un `Referer`— ya lo tapa `Referrer-Policy: no-referrer`, y además el
 * navegador nunca envía el fragmento al servidor.
 *
 * El resto de parámetros se conserva tal cual y en su orden: son los que identifican la vacante (`jk`,
 * `currentJobId`…), y esto no es una forma canónica sino un enlace que tiene que seguir funcionando.
 */
export function publicHttpUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (!PUBLISHABLE_PROTOCOLS.has(parsed.protocol) || parsed.hostname === '') {
    return null;
  }
  parsed.username = '';
  parsed.password = '';
  for (const name of [...parsed.searchParams.keys()]) {
    if (isCampaignParam(name)) {
      parsed.searchParams.delete(name);
    }
  }
  return parsed.toString();
}
