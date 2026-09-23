import {
  importLinksRequestSchema,
  listLinksQuerySchema,
  pastedDescriptionRequestSchema,
  reopenLinkRequestSchema,
  saveLinkRequestSchema,
  updatePreviewRequestSchema,
  type EnrichLinkResponse,
  type ImportLinksRequest,
  type ImportLinksResponse,
  type JobLinkSummary,
  type LinkPage,
  type ListLinksQuery,
  type PastedDescriptionRequest,
  type ReopenLinkRequest,
  type ReopenLinkResponse,
  type SaveLinkRequest,
  type SaveLinkResponse,
  type UpdatePreviewRequest,
  type UpdatePreviewResponse,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import {
  clientClosedSignal,
  type RawResponse,
} from '../../../presentation/http/client-closed-signal';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { ImportLinks } from '../application/import-links.usecase';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { PasteDescription } from '../application/paste-description.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { ReopenJobLink } from '../application/reopen-job-link.usecase';
import { RequestLinkEnrichment } from '../application/request-link-enrichment.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { UpdateLinkPreview } from '../application/update-link-preview.usecase';

/**
 * Guardar, importar y la lista privada (spec links/sharing). Todas las rutas exigen access token: el guard global de
 * `AuthModule` protege lo que no está marcado con `@Public()`, y aquí no hay nada público.
 *
 * Los identificadores de la URL **no** se validan con el pipe: un `:linkId` mal formado tiene que acabar en el mismo
 * `404` que un link que no está en la lista, no en el `400` genérico. Con el cuerpo pasa algo parecido: la URL y el
 * texto solo llevan cotas de cordura, para que el dominio pueda responder `invalid_url` y `text_too_long`.
 */
@Controller('links')
export class LinksController {
  constructor(
    private readonly saveLink: SaveLink,
    private readonly importLinks: ImportLinks,
    private readonly listMyLinks: ListMyLinks,
    private readonly removeMyLink: RemoveMyLink,
    private readonly updateLinkPreview: UpdateLinkPreview,
    private readonly requestLinkEnrichment: RequestLinkEnrichment,
    private readonly pasteDescription: PasteDescription,
    private readonly reopenJobLink: ReopenJobLink,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  save(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(saveLinkRequestSchema)) body: SaveLinkRequest,
  ): Promise<SaveLinkResponse> {
    return this.saveLink.execute(user.userId, body);
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  import(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(importLinksRequestSchema))
    body: ImportLinksRequest,
  ): Promise<ImportLinksResponse> {
    return this.importLinks.execute(user.userId, body);
  }

  /** Antes que `mine/:linkId` no hace falta por el enrutador, pero deja claro que `mine` no es un identificador. */
  @Get('mine')
  mine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listLinksQuerySchema)) query: ListLinksQuery,
  ): Promise<LinkPage> {
    return this.listMyLinks.execute(user.userId, query);
  }

  /**
   * Corregir a mano el preview de una oferta. El cuerpo acepta campos que no existen **a propósito**: el caso de uso los
   * rechaza con `preview_field_unknown` nombrando cuál, que es lo que el SPA sabe explicar, y no con el
   * `validation_error` genérico del pipe.
   */
  @Patch(':linkId/preview')
  updatePreview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(updatePreviewRequestSchema))
    body: UpdatePreviewRequest,
  ): Promise<UpdatePreviewResponse> {
    return this.updateLinkPreview.execute(user.userId, linkId, body);
  }

  /**
   * Reabrir una vacante cerrada por frescura (ADR-041). Body opcional con `expiresAt` date-only o `null`. Idempotente
   * si ya estaba abierta.
   */
  @Post(':linkId/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(reopenLinkRequestSchema))
    body: ReopenLinkRequest,
  ): Promise<ReopenLinkResponse> {
    return this.reopenJobLink.execute(user.userId, linkId, body);
  }

  /**
   * Volver a pedir la lectura de una oferta. Responde `202`: la petición queda apuntada en el outbox y la lectura la
   * hará el worker, así que aquí no hay nada terminado que devolver más allá del link ya en `pending`.
   */
  @Post(':linkId/enrich')
  @HttpCode(HttpStatus.ACCEPTED)
  enrich(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
  ): Promise<EnrichLinkResponse> {
    return this.requestLinkEnrichment.execute(user.userId, linkId);
  }

  /**
   * Completar una oferta pegando su texto (spec links/pasted-description). Responde `200` con el link ya actualizado: la
   * IA lee el texto dentro de esta misma petición. El pipe valida antes que el caso de uso, así que un texto vacío es
   * `400` y uno de más de 20 000 caracteres `400` `text_too_long` sin mirar siquiera el link.
   *
   * Si el cliente cierra la conexión antes de la respuesta, la lectura se aborta. `passthrough` deja que Nest siga
   * respondiendo como siempre: la respuesta en crudo solo se mira para saber si se fue.
   */
  @Post(':linkId/pasted')
  @HttpCode(HttpStatus.OK)
  pasted(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(pastedDescriptionRequestSchema))
    body: PastedDescriptionRequest,
    @Res({ passthrough: true }) reply: { readonly raw: RawResponse },
  ): Promise<JobLinkSummary> {
    return this.pasteDescription.execute(
      user.userId,
      linkId,
      body,
      clientClosedSignal(reply.raw),
    );
  }

  @Delete('mine/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeMine(
    @CurrentUser() user: AuthenticatedUser,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    return this.removeMyLink.execute(user.userId, linkId);
  }
}
