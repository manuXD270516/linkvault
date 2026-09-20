import type { PublicShare as PublicShareView } from '@linkvault/shared';
import type { PublicShare } from '../domain/public-share';
import type { PublicUrls } from './ports/public-urls.port';

/**
 * Enlace público tal y como sale por la API (D10 de public-preview-share). La URL se compone aquí, con la configuración,
 * para que el SPA la copie al portapapeles sin saber de qué está hecha.
 *
 * `publishedBy` **no** viaja: quién encendió el interruptor no se enseña ni en el listado ni en la página. Es una lista
 * explícita de campos, no un `...share`, por la misma razón que el mapeo del preview público.
 */
export function toPublicShareView(
  share: PublicShare,
  urls: PublicUrls,
): PublicShareView {
  return {
    slug: share.slug,
    url: urls.pageUrlOf(share.slug),
    publishedAt: share.publishedAt.toISOString(),
  };
}
