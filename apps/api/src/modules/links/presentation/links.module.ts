import { Module, type OnModuleInit } from '@nestjs/common';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { GroupDeletionHooks } from '../../groups/application/group-deletion-hooks';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { UsersModule } from '../../users/presentation/users.module';
import { ImportLinks } from '../application/import-links.usecase';
import { ListGroupLinks } from '../application/list-group-links.usecase';
import { ListMyLinks } from '../application/list-my-links.usecase';
import { LINKS_CLOCK } from '../application/ports/clock.port';
import { GROUP_LINK_REPOSITORY } from '../application/ports/group-link-repository.port';
import { GROUP_MEMBERSHIP } from '../application/ports/group-membership.port';
import { JOB_LINK_REPOSITORY } from '../application/ports/job-link-repository.port';
import { LINK_USER_DIRECTORY } from '../application/ports/link-user-directory.port';
import { USER_LINK_REPOSITORY } from '../application/ports/user-link-repository.port';
import { RemoveGroupLink } from '../application/remove-group-link.usecase';
import { RemoveMyLink } from '../application/remove-my-link.usecase';
import { SaveLink } from '../application/save-link.usecase';
import { GroupLinksDeletionHook } from '../infrastructure/group-links-deletion.hook';
import { GroupsFacadeMembership } from '../infrastructure/groups-facade-membership';
import { MongoGroupLinkRepository } from '../infrastructure/mongo-group-link.repository';
import { MongoJobLinkRepository } from '../infrastructure/mongo-job-link.repository';
import { MongoUserLinkRepository } from '../infrastructure/mongo-user-link.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeLinkDirectory } from '../infrastructure/users-facade-link-directory';
import { GroupLinksController } from './group-links.controller';
import { LinksController } from './links.controller';

/**
 * Módulo `links` (D1 de job-links). Usa la conexión Mongoose por defecto de la app (`getConnectionToken()`), así que
 * quien lo importa debe registrar `MongooseModule.forRoot*`.
 *
 * Importa `GroupsModule` para la pertenencia y el rol (`GroupsFacade`), `UsersModule` para los nombres visibles de quien
 * compartió (`UsersFacade`) y `OutboxModule` para escribir el evento dentro de la transacción del alta: la dependencia
 * va siempre de `links` a los demás, que es la dirección permitida. No exporta nada: todavía nadie entra a `links`.
 *
 * Al arrancar registra su limpieza en `GroupDeletionHooks`, para que borrar un grupo se lleve sus `GroupLink` dentro de
 * la misma transacción y no deje relaciones huérfanas (D7b). `groups` sigue sin conocer a `links`.
 */
@Module({
  imports: [GroupsModule, UsersModule, OutboxModule],
  controllers: [LinksController, GroupLinksController],
  providers: [
    { provide: JOB_LINK_REPOSITORY, useClass: MongoJobLinkRepository },
    { provide: GROUP_LINK_REPOSITORY, useClass: MongoGroupLinkRepository },
    { provide: USER_LINK_REPOSITORY, useClass: MongoUserLinkRepository },
    { provide: GROUP_MEMBERSHIP, useClass: GroupsFacadeMembership },
    { provide: LINK_USER_DIRECTORY, useClass: UsersFacadeLinkDirectory },
    { provide: LINKS_CLOCK, useClass: SystemClock },
    SaveLink,
    ImportLinks,
    ListGroupLinks,
    ListMyLinks,
    RemoveGroupLink,
    RemoveMyLink,
    GroupLinksDeletionHook,
  ],
})
export class LinksModule implements OnModuleInit {
  constructor(
    private readonly deletionHooks: GroupDeletionHooks,
    private readonly groupLinksDeletion: GroupLinksDeletionHook,
  ) {}

  onModuleInit(): void {
    this.deletionHooks.register(this.groupLinksDeletion);
  }
}
