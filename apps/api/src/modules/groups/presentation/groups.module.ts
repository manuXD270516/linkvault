import {
  type BeforeApplicationShutdown,
  Inject,
  Logger,
  Module,
  type OnModuleInit,
} from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { mongo, type Connection } from 'mongoose';
import { UsersModule } from '../../users/presentation/users.module';
import { CreateGroup } from '../application/create-group.usecase';
import { DeleteGroup } from '../application/delete-group.usecase';
import { GetGroup } from '../application/get-group.usecase';
import { GroupDeletionHooks } from '../application/group-deletion-hooks';
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
import {
  GROUP_MEMBER_MODEL_NAME,
  GROUP_MEMBERS_COLLECTION,
  groupMemberSchema,
  ONE_OWNER_PER_GROUP_INDEX,
} from '../infrastructure/group.schemas';
import { MongoGroupRepository } from '../infrastructure/mongo-group.repository';
import { RandomInviteCodeGenerator } from '../infrastructure/random-invite-code-generator';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeMemberDirectory } from '../infrastructure/users-facade-member-directory';
import { GroupsController } from './groups.controller';

/**
 * Módulo `groups` (D1 y D7). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que quien lo
 * importa debe registrar `MongooseModule.forRoot*`. Importa `UsersModule` solo para los nombres visibles de los miembros
 * (`UsersFacade`, a través de `UsersFacadeMemberDirectory`) y exporta `GroupsFacade` —la única entrada del resto de la
 * API a los grupos— y `GroupDeletionHooks`, donde otro módulo registra la limpieza de lo suyo al borrar un grupo (D7b de
 * job-links): sin hooks registrados, el borrado se comporta como antes.
 *
 * Al arrancar espera a que se construyan los índices de `group_members` (ADR-025 §5). Si fallan —por ejemplo, porque
 * datos antiguos tienen un grupo con dos owners y `one_owner_per_group` no se puede crear—, registra un `error` con el
 * nombre del índice y el motivo, sin datos de grupos ni usuarios, y **no** detiene el arranque: la transacción de la
 * transferencia sigue impidiendo grupos sin owner, y el RUNBOOK dice cómo encontrar y resolver los duplicados.
 *
 * La espera corre en segundo plano (`indexesReady`) y no retiene `onModuleInit`: Mongoose no construye los índices
 * hasta que la conexión se abre, y la API arranca sin esperar a MongoDB (D8 de la plataforma). Si la app se apaga antes,
 * no se registra nada: no es un índice que falló.
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
    GroupDeletionHooks,
  ],
  exports: [GroupsFacade, GroupDeletionHooks],
})
export class GroupsModule implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(GroupsModule.name);
  private stopping = false;
  /** Termina cuando los índices de `group_members` se han construido o su fallo se ha registrado; nunca rechaza. */
  indexesReady: Promise<void> = Promise.resolve();

  constructor(
    @Inject(getConnectionToken()) private readonly connection: Connection,
  ) {}

  onModuleInit(): void {
    this.indexesReady = this.buildMemberIndexes();
  }

  beforeApplicationShutdown(): void {
    this.stopping = true;
  }

  private async buildMemberIndexes(): Promise<void> {
    const members =
      this.connection.models[GROUP_MEMBER_MODEL_NAME] ??
      this.connection.model(GROUP_MEMBER_MODEL_NAME, groupMemberSchema);
    try {
      await members.init();
    } catch (error) {
      if (this.stopping) {
        return;
      }
      this.logger.error(
        `Could not build the index ${ONE_OWNER_PER_GROUP_INDEX} of ${GROUP_MEMBERS_COLLECTION}: ${indexFailureReason(error)}`,
      );
    }
  }
}

/**
 * Motivo del fallo sin el mensaje del servidor: el de una clave duplicada lleva el `groupId` repetido. Basta el tipo de
 * error y su código (`11000 DuplicateKey` para dos owners en un grupo).
 */
function indexFailureReason(error: unknown): string {
  if (error instanceof mongo.MongoServerError) {
    return [error.name, error.code, error.codeName]
      .filter((part) => part !== undefined)
      .join(' ');
  }
  return error instanceof Error ? error.name : typeof error;
}
