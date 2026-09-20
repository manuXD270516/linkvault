// Puerto de las URLs públicas (D5 de public-preview-share, ADR-027 §4). Salen de **configuración**, nunca de la
// cabecera `Host` de la petición: un `Host` falsificado acabaría dentro de una etiqueta Open Graph que los chats
// muestran y cachean, y dentro del enlace que alguien copia para pegarlo en un chat.
//
// Es un puerto y no una lectura directa de la configuración para que los casos de uso y la plantilla no conozcan
// `ApiConfig`, y para que un test pueda fijar los dos orígenes sin levantar la app.

export const PUBLIC_URLS = Symbol('PUBLIC_URLS');

export interface PublicUrls {
  /** URL absoluta de la página pública de ese slug: la que se pega en un chat y la que va en `og:url`. */
  pageUrlOf(slug: string): string;
  /** URL absoluta de la vista pública del SPA, adonde salta la página. */
  webUrlOf(slug: string): string;
  /** Origen del SPA, del que cuelgan sus estáticos (la imagen fija de las tarjetas). Sin barra final. */
  readonly webBaseUrl: string;
}
