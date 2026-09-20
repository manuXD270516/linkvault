import {
  listLinksQuerySchema,
  type LinkPage,
  type ListLinksQuery,
  type PublicShare,
} from '@linkvault/shared';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { PublishGroupLink } from '../application/publish-group-link.usecase';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveShareNote } from '../application/remove-share-note.usecase';
import { UnpublishGroupLink } from '../application/unpublish-group-link.usecase';

/**
 * Links de un grupo (spec links/sharing). Viven en `links` y no en `groups` porque su contenido es de este módulo; la
 * pertenencia se resuelve por el puerto GROUP_MEMBERSHIP, sobre el facade de `groups`.
 *
 * Quien no es miembro recibe `group_not_found`, igual que si el grupo no existiera, y un `:id` mal formado responde lo
 * mismo: por eso los identificadores de la URL no pasan por el pipe.
 */
@Controller('groups')
export class GroupLinksController {
  constructor(
    private readonly listGroupLinks: ListGroupLinks,
    private readonly removeGroupLink: RemoveGroupLink,
    private readonly removeShareNote: RemoveShareNote,
    private readonly publishGroupLink: PublishGroupLink,
    private readonly unpublishGroupLink: UnpublishGroupLink,
  ) {}

  @Get(':id/links')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Query(new ZodValidationPipe(listLinksQuerySchema)) query: ListLinksQuery,
  ): Promise<LinkPage> {
    return this.listGroupLinks.execute(user.userId, groupId, query);
  }

  @Delete(':id/links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    return this.removeGroupLink.execute(user.userId, groupId, linkId);
  }

  /**
   * Enciende el enlace público del link (spec links/public-share). `PUT` y no `POST` porque es **idempotente**: dos
   * pestañas no dejan dos enlaces vivos, y la segunda recibe el mismo `slug`.
   */
  @Put(':id/links/:linkId/public')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
  ): Promise<PublicShare> {
    return this.publishGroupLink.execute(user.userId, groupId, linkId);
  }

  /** Lo apaga y **quema** el slug: `204` estuviera publicado o no. */
  @Delete(':id/links/:linkId/public')
  @HttpCode(HttpStatus.NO_CONTENT)
  unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    return this.unpublishGroupLink.execute(user.userId, groupId, linkId);
  }

  /**
   * Quita la nota de quien compartió (D3 de group-comments). No hay `PATCH`: la nota no se edita, solo se quita, así que
   * esa ruta responde `404`.
   */
  @Delete(':id/links/:linkId/note')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
  ): Promise<void> {
    return this.removeShareNote.execute(user.userId, groupId, linkId);
  }
}
