import type { GroupTracker, GroupTrackersResponse } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { TrackersGroupNotFound } from '../domain/errors';
import {
  APPLICATION_GROUPS,
  type ApplicationGroups,
} from './ports/application-groups.port';
import {
  APPLICATION_LINKS,
  type ApplicationLinks,
} from './ports/application-links.port';
import {
  APPLICATION_REPOSITORY,
  type ApplicationRepository,
} from './ports/application-repository.port';
import {
  APPLICATION_USER_DIRECTORY,
  type ApplicationUserDirectory,
} from './ports/application-user-directory.port';

/**
 * `GET /api/groups/:id/applications?linkIds=…` (spec applications/group-visibility). La visibilidad se **deriva en cada
 * lectura** (ADR-024 §6): una postulación aparece en la tarjeta del link L en el grupo G si y solo si es `group`, su
 * dueño es miembro actual de G y L está compartido ahora en G. Nada se escribe al salir, al ser expulsado, al quitar el
 * link ni al borrar el grupo.
 *
 * Plan **fijo** de cuatro lecturas, una por puerto, pida 2 links o 50 (D6):
 * 1. Miembros de G, que dicen además si quien pide es miembro (si no, `group_not_found`).
 * 2. Cuáles de los links están compartidos en G.
 * 3. Postulaciones compartidas de esos links por esos miembros.
 * 4. Nombres visibles de quienes aparecen.
 *
 * Cada link pedido que está en G sale en la respuesta, también sin nadie (`trackers` vacío), en el orden en que se
 * pidió; sus trackers, por `statusChangedAt` descendente: editar una nota no reordena.
 */
@Injectable()
export class ListGroupTrackers {
  constructor(
    @Inject(APPLICATION_GROUPS) private readonly groups: ApplicationGroups,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_USER_DIRECTORY)
    private readonly directory: ApplicationUserDirectory,
  ) {}

  async execute(
    userId: string,
    groupId: string,
    linkIds: readonly string[],
  ): Promise<GroupTrackersResponse> {
    const members = await this.groups.memberIdsOf(groupId);
    if (!members.includes(userId)) {
      throw new TrackersGroupNotFound();
    }
    const shared = await this.links.linkIdsSharedIn(groupId, linkIds);
    const inGroup = linkIds.filter((linkId) => shared.has(linkId));
    const applications = await this.applications.sharedOn(inGroup, members);
    const names = await this.directory.displayNamesOf([
      ...new Set(applications.map((application) => application.userId)),
    ]);

    const byLink = new Map<string, typeof applications>();
    for (const application of applications) {
      byLink.set(application.linkId, [
        ...(byLink.get(application.linkId) ?? []),
        application,
      ]);
    }
    return {
      items: inGroup.map((linkId) => ({
        linkId,
        trackers: (byLink.get(linkId) ?? [])
          .slice()
          .sort(
            (left, right) =>
              right.statusChangedAt.getTime() -
                left.statusChangedAt.getTime() ||
              left.userId.localeCompare(right.userId),
          )
          .flatMap((application): GroupTracker[] => {
            const displayName = names.get(application.userId);
            return displayName === undefined
              ? []
              : [
                  {
                    userId: application.userId,
                    displayName,
                    status: application.status,
                  },
                ];
          }),
      })),
    };
  }
}
