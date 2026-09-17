import { Module } from '@nestjs/common';
import { UsersModule } from '../../users/presentation/users.module';
import { CreateGroup } from '../application/create-group.usecase';
import { DeleteGroup } from '../application/delete-group.usecase';
import { GetGroup } from '../application/get-group.usecase';
import { GroupsFacade } from '../application/groups.facade';
import { JoinByCode } from '../application/join-by-code.usecase';
import { LeaveGroup } from '../application/leave-group.usecase';
import { ListMembers } from '../application/list-members.usecase';
import { ListMyGroups } from '../application/list-my-groups.usecase';
import { GROUPS_CLOCK } from '../application/ports/clock.port';
import { GROUP_MEMBER_DIRECTORY } from '../application/ports/group-member-directory.port';
import { GROUP_REPOSITORY } from '../application/ports/group-repository.port';
import { INVITE_CODE_GENERATOR } from '../application/ports/invite-code-generator.port';
import { RemoveMember } from '../application/remove-member.usecase';
import { RenameGroup } from '../application/rename-group.usecase';
import { RotateInviteCode } from '../application/rotate-invite-code.usecase';
import { MongoGroupRepository } from '../infrastructure/mongo-group.repository';
import { RandomInviteCodeGenerator } from '../infrastructure/random-invite-code-generator';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeMemberDirectory } from '../infrastructure/users-facade-member-directory';
import { GroupsController } from './groups.controller';

/**
 * Módulo `groups` (D1 y D7). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que quien lo
 * importa debe registrar `MongooseModule.forRoot*`. Importa `UsersModule` solo para los nombres visibles de los miembros
 * (`UsersFacade`, a través de `UsersFacadeMemberDirectory`) y exporta únicamente `GroupsFacade`: es la única entrada del
 * resto de la API a los grupos, y lo que consumirá `job-links`.
 */
@Module({
  imports: [UsersModule],
  controllers: [GroupsController],
  providers: [
    { provide: GROUP_REPOSITORY, useClass: MongoGroupRepository },
    { provide: GROUPS_CLOCK, useClass: SystemClock },
    { provide: INVITE_CODE_GENERATOR, useClass: RandomInviteCodeGenerator },
    { provide: GROUP_MEMBER_DIRECTORY, useClass: UsersFacadeMemberDirectory },
    CreateGroup,
    ListMyGroups,
    GetGroup,
    RenameGroup,
    DeleteGroup,
    RotateInviteCode,
    JoinByCode,
    ListMembers,
    LeaveGroup,
    RemoveMember,
    GroupsFacade,
  ],
  exports: [GroupsFacade],
})
export class GroupsModule {}
