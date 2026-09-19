import {
  createCommentRequestSchema,
  listCommentsQuerySchema,
  type CommentPage,
  type CreateCommentRequest,
  type CreateCommentResponse,
  type DeleteCommentResponse,
  type ListCommentsQuery,
} from '@linkvault/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { DeleteGroupLinkComment } from '../application/delete-group-link-comment.usecase';
import { ListGroupLinkComments } from '../application/list-group-link-comments.usecase';
import { PostGroupLinkComment } from '../application/post-group-link-comment.usecase';

/**
 * Comentarios de un link en un grupo (spec links/group-comments, D1 de group-comments). Viven en `links` porque un
 * comentario cuelga de la relación link-grupo, que es de este módulo.
 *
 * Los identificadores de la URL **no** pasan por el pipe: un `:id`, un `:linkId` o un `:commentId` mal formados
 * responden el mismo `404` que uno inexistente (`group_not_found`, `link_not_found`, `comment_not_found`), y eso lo
 * decide el caso de uso. No hay `PATCH`: nadie edita un comentario (ADR-026 §4), así que esa ruta responde `404`.
 */
@Controller('groups')
export class GroupLinkCommentsController {
  constructor(
    private readonly postComment: PostGroupLinkComment,
    private readonly listComments: ListGroupLinkComments,
    private readonly deleteComment: DeleteGroupLinkComment,
  ) {}

  @Post(':id/links/:linkId/comments')
  @HttpCode(HttpStatus.CREATED)
  post(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
    @Body(new ZodValidationPipe(createCommentRequestSchema))
    body: CreateCommentRequest,
  ): Promise<CreateCommentResponse> {
    return this.postComment.execute(user.userId, groupId, linkId, body);
  }

  @Get(':id/links/:linkId/comments')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
    @Query(new ZodValidationPipe(listCommentsQuerySchema))
    query: ListCommentsQuery,
  ): Promise<CommentPage> {
    return this.listComments.execute(user.userId, groupId, linkId, query);
  }

  @Delete(':id/links/:linkId/comments/:commentId')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('linkId') linkId: string,
    @Param('commentId') commentId: string,
  ): Promise<DeleteCommentResponse> {
    return this.deleteComment.execute(user.userId, groupId, linkId, commentId);
  }
}
