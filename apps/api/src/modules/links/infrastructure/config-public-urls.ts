import type { PublicUrls } from '../application/ports/public-urls.port';

/**
 * Adaptador de PUBLIC_URLS sobre `PUBLIC_PAGE_BASE_URL` y `WEB_BASE_URL` (D5 de public-preview-share). Las dos llegan
 * validadas: absolutas, `http(s)` y sin barra final, así que componer es concatenar y no hace falta normalizar nada.
 *
 * El slug **no** se escapa aquí: quien lo compone ya comprobó su formato con `isValidPublicSlug`, y la plantilla escapa
 * todo lo que entra en el HTML.
 */
export class ConfigPublicUrls implements PublicUrls {
  constructor(
    private readonly pageBaseUrl: string,
    readonly webBaseUrl: string,
  ) {}

  pageUrlOf(slug: string): string {
    return `${this.pageBaseUrl}/p/${slug}`;
  }

  webUrlOf(slug: string): string {
    return `${this.webBaseUrl}/oferta/${slug}`;
  }
}
