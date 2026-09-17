import {
  createGroupRequestSchema,
  joinGroupRequestSchema,
  renameGroupRequestSchema,
  type CreateGroupRequest,
  type GroupDetail,
  type GroupMember,
  type GroupSummary,
  type InviteCodeResponse,
  type JoinGroupRequest,
  type RenameGroupRequest,
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
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../../presentation/http/auth-context/authenticated-user';
import { CurrentUser } from '../../../presentation/http/auth-context/current-user.decorator';
import { ZodValidationPipe } from '../../../presentation/http/zod-validation.pipe';
import { CreateGroup } from '../application/create-group.usecase';
import { DeleteGroup } from '../application/delete-group.usecase';
import { GetGroup } from '../application/get-group.usecase';
import { JoinByCode } from '../application/join-by-code.usecase';
import { LeaveGroup } from '../application/leave-group.usecase';
import { ListMembers } from '../application/list-members.usecase';
import { ListMyGroups } from '../application/list-my-groups.usecase';
import { RemoveMember } from '../application/remove-member.usecase';
import { RenameGroup } from '../application/rename-group.usecase';
import { RotateInviteCode } from '../application/rotate-invite-code.usecase';

/**
 * Grupos y membresías (specs groups/group-management y groups/membership). Todas las rutas exigen access token: el guard
 * global de `AuthModule` protege lo que no está marcado con `@Public()`, y aquí no hay nada público.
 *
 * Los identificadores de la URL **no** se validan con el pipe: un `:id` mal formado tiene que acabar en el mismo `404`
 * que un grupo ajeno (D2), no en el `400` genérico, así que viajan tal cual hasta el dominio.
 */
@Controller('groups')
export class GroupsController {
  constructor(
    private readonly createGroup: CreateGroup,
    private readonly listMyGroups: ListMyGroups,
    private readonly getGroup: GetGroup,
    private readonly renameGroup: RenameGroup,
    private readonly deleteGroup: DeleteGroup,
    private readonly rotateInviteCode: RotateInviteCode,
    private readonly joinByCode: JoinByCode,
    private readonly listMembers: ListMembers,
    private readonly leaveGroup: LeaveGroup,
    private readonly removeMember: RemoveMember,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createGroupRequestSchema))
    body: CreateGroupRequest,
  ): Promise<GroupDetail> {
    return this.createGroup.execute(user.userId, body.name);
  }

  @Get()
  list(@CurrentUser() user: AuthenticatedUser): Promise<GroupSummary[]> {
    return this.listMyGroups.execute(user.userId);
  }

  /** Antes que `:id` no hace falta por el enrutador, pero deja claro que `join` no es un identificador. */
  @Post('join')
  @HttpCode(HttpStatus.OK)
  join(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(joinGroupRequestSchema)) body: JoinGroupRequest,
  ): Promise<GroupSummary> {
    return this.joinByCode.execute(user.userId, body.code);
  }

  @Get(':id')
  detail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
  ): Promise<GroupDetail> {
    return this.getGroup.execute(user.userId, groupId);
  }

  @Patch(':id')
  rename(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Body(new ZodValidationPipe(renameGroupRequestSchema))
    body: RenameGroupRequest,
  ): Promise<GroupDetail> {
    return this.renameGroup.execute(user.userId, groupId, body.name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
  ): Promise<void> {
    return this.deleteGroup.execute(user.userId, groupId);
  }

  @Post(':id/invite-code')
  @HttpCode(HttpStatus.OK)
  rotate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
  ): Promise<InviteCodeResponse> {
    return this.rotateInviteCode.execute(user.userId, groupId);
  }

  @Get(':id/members')
  members(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
  ): Promise<GroupMember[]> {
    return this.listMembers.execute(user.userId, groupId);
  }

  @Delete(':id/members/me')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
  ): Promise<void> {
    return this.leaveGroup.execute(user.userId, groupId);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  expel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') groupId: string,
    @Param('userId') memberId: string,
  ): Promise<void> {
    return this.removeMember.execute(user.userId, groupId, memberId);
  }
}
