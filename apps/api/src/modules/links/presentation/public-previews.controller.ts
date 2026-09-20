import type { PublicPreviewResponse } from '@linkvault/shared';
import { Controller, Get, Inject, Param } from '@nestjs/common';
import { PublicRouteLogger } from '../../../infrastructure/logging/public-route-logger';
import { Public } from '../../../presentation/http/auth-context/public.decorator';
import { GetPublicPreview } from '../application/get-public-preview.usecase';
import { LinkNotFound, TooManyLinkAttempts } from '../domain/errors';
import {
  LINK_LIMITER,
  type LinkLimiter,
} from '../application/ports/link-limiter.port';

/**
 * `GET /api/public/previews/:slug` (spec links/public-share, D9 de public-preview-share): lo que lee la vista pública
 * del SPA. Sin sesión, bajo el prefijo `/api/public/`, **reservado a lecturas** que no escriben nada y no devuelven
 * datos de una persona identificable.
 *
 * Tiene su propio contador global de ruta, independiente del de la página: una avalancha de bots contra `/p/:slug` no
 * puede dejar sin ver la oferta a quien ya está en `/oferta/:slug`. Se consume **antes** de leer y falla abierto.
 *
 * Un slug inexistente, quemado o mal formado responde `404 link_not_found` con el **mismo cuerpo** en los tres casos, y
 * un slug mal formado no cuesta ninguna lectura. Cada petición deja `{ slug, status }` en el log y nada más.
 */
@Public()
@Controller('public/previews')
export class PublicPreviewsController {
  constructor(
    private readonly preview: GetPublicPreview,
    @Inject(LINK_LIMITER) private readonly limiter: LinkLimiter,
    private readonly log: PublicRouteLogger,
  ) {}

  @Get(':slug')
  async of(@Param('slug') slug: string): Promise<PublicPreviewResponse> {
    const decision = await this.limiter.consume({ kind: 'public-preview' });
    if (!decision.allowed) {
      this.record(slug, 429);
      throw new TooManyLinkAttempts(decision.retryAfterSeconds);
    }
    const found = await this.preview.execute(slug);
    if (found === null) {
      this.record(slug, 404);
      throw new LinkNotFound();
    }
    this.record(slug, 200);
    return found;
  }

  /** `{ slug, status }` y nada más: ni dirección de origen, ni `User-Agent`, ni referente. */
  private record(slug: string, status: number): void {
    this.log.record('public-preview', slug, status);
  }
}
