import {
  groupTrackersQuerySchema,
  type GroupTrackersQuery,
  type GroupTrackersResponse,
} from '@linkvault/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { ListGroupTrackers } from '../application/list-group-trackers.usecase';

/**
 * Estados compartidos de una página de tarjetas de un grupo (spec applications/group-visibility), bajo
 * `groups/:id/applications` como `GroupLinksController` de `links`: su contenido es de este módulo. Quien no es miembro
 * y un `:id` mal formado reciben `group_not_found`, así que el identificador de la URL no pasa por el pipe.
 */
@Controller('groups')
export class GroupApplicationsController {
  constructor(private readonly listGroupTrackers: ListGroupTrackers) {}

  @Get(':id/applications')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Query(new ZodValidationPipe(groupTrackersQuerySchema))
    query: GroupTrackersQuery,
  ): Promise<GroupTrackersResponse> {
    return this.listGroupTrackers.execute(user.userId, groupId, query.linkIds);
  }
}
