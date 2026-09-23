import { type DynamicModule, Module } from '@nestjs/common';
import { OutboxModule } from '../../../infrastructure/outbox/outbox.module';
import { GroupsModule } from '../../groups/presentation/groups.module';
import { UsersModule } from '../../users/presentation/users.module';
import { ApplicationFitScores } from '../application/application-fit-scores';
import { ChangeApplicationStatus } from '../application/change-application-status.usecase';
import { GetApplicationAnalytics } from '../application/get-application-analytics.usecase';
import { GetApplicationTimeline } from '../application/get-application-timeline.usecase';
import { ListGroupTrackers } from '../application/list-group-trackers.usecase';
import { ListMyApplications } from '../application/list-my-applications.usecase';
import { APPLICATION_GROUPS } from '../application/ports/application-groups.port';
import { APPLICATION_LINKS } from '../application/ports/application-links.port';
import { APPLICATION_REPOSITORY } from '../application/ports/application-repository.port';
import { APPLICATION_USER_DIRECTORY } from '../application/ports/application-user-directory.port';
import { APPLICATIONS_CLOCK } from '../application/ports/clock.port';
import { TrackLink } from '../application/track-link.usecase';
import { UntrackApplication } from '../application/untrack-application.usecase';
import { UpdateApplication } from '../application/update-application.usecase';
import { GroupsFacadeApplicationGroups } from '../infrastructure/groups-facade-application-groups';
import { LinksFacadeApplicationLinks } from '../infrastructure/links-facade-application-links';
import { MongoApplicationRepository } from '../infrastructure/mongo-application.repository';
import { SystemClock } from '../infrastructure/system-clock';
import { UsersFacadeApplicationDirectory } from '../infrastructure/users-facade-application-directory';
import { ApplicationsController } from './applications.controller';
import { GroupApplicationsController } from './group-applications.controller';

/**
 * Módulo `applications` (D1 de applications-tracking). Usa la conexión Mongoose por defecto de la app, así que quien lo
 * importa debe registrar `MongooseModule.forRoot*`.
 *
 * Depende de `links`, `groups` y `users`, siempre por sus fachadas y detrás de puertos propios; nadie depende de él salvo
 * el registro de `ApplicationFitScores` (D11): `match` se registra en su `onModuleInit` y este módulo no importa a
 * `match`. Encola `ApplicationStatusNotify.v1` vía outbox (ADR-009 / ADR-035) al cambiar status canónico con
 * `visibility=group`. No registra ningún hook de borrado de grupo: una postulación no guarda
 * nada que cuelgue de un grupo y su visibilidad allí se deriva en cada lectura (ADR-024 §6).
 *
 * `LinksModule` le llega por `register(linksModule)` y no importando la clase: `AppModule` lo construye una sola vez
 * con `LinksModule.register(aiModule)` y le pasa **el mismo objeto**, así que Nest lo instancia una vez. Importar la
 * clase a secas crearía una segunda instancia sin `RUN_TASK` y la app no arrancaría (ADR-023 §1).
 */
@Module({
  imports: [GroupsModule, UsersModule, OutboxModule],
  controllers: [ApplicationsController, GroupApplicationsController],
  providers: [
    { provide: APPLICATION_REPOSITORY, useClass: MongoApplicationRepository },
    { provide: APPLICATION_LINKS, useClass: LinksFacadeApplicationLinks },
    { provide: APPLICATION_GROUPS, useClass: GroupsFacadeApplicationGroups },
    {
      provide: APPLICATION_USER_DIRECTORY,
      useClass: UsersFacadeApplicationDirectory,
    },
    { provide: APPLICATIONS_CLOCK, useClass: SystemClock },
    ApplicationFitScores,
    TrackLink,
    ListMyApplications,
    GetApplicationAnalytics,
    ChangeApplicationStatus,
    UpdateApplication,
    GetApplicationTimeline,
    UntrackApplication,
    ListGroupTrackers,
  ],
  exports: [ApplicationFitScores],
})
export class ApplicationsModule {
  /** `ApplicationsModule` con la instancia de `LinksModule` que construye `AppModule`, que exporta `LinksFacade`. */
  static register(
    linksModule: DynamicModule,
    searchModule?: DynamicModule,
  ): DynamicModule {
    return {
      module: ApplicationsModule,
      imports: [
        linksModule,
        ...(searchModule === undefined ? [] : [searchModule]),
      ],
    };
  }
}
