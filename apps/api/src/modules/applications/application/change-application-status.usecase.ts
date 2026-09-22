import type {
  Application as ApplicationResponse,
  ChangeApplicationStatusRequest,
} from '@linkvault/shared';
import {
  applicationStatusNotifyEvent,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { OUTBOX, type Outbox } from '../../../infrastructure/outbox/outbox.port';
import type { TransactionSession } from '../../../infrastructure/outbox/transaction-session';
import { changeStatus } from '../domain/application.entity';
import {
  ApplicationConflict,
  ApplicationNotFound,
  InvalidNotifyGroupId,
} from '../domain/errors';
import { ApplicationFitScores } from './application-fit-scores';
import { respondWithCard } from './respond-with-card';
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
import { APPLICATIONS_CLOCK, type Clock } from './ports/clock.port';

/**
 * `PATCH /api/applications/:id/status` (spec applications/tracking + notifications ADR-035), en el orden de D5:
 * 1. Leer la postulación de quien pide; si no es suya o no existe, `application_not_found`.
 * 2. Calcular estado y etapa resultantes; si son los que ya tiene, responder `200` con ella **sin escribir y sin mirar
 *    la versión**: un doble clic desde una pestaña vieja no es un conflicto.
 * 3. Si la versión enviada no es la actual, `application_conflict`. Si lo es, escritura condicionada por la versión con
 *    su evento en la misma transacción; si no casa (otra pestaña ganó entre la lectura y la escritura), se relee: ya no
 *    existe → `404`; existe → `409`.
 * 4. Si `visibility=group` y cambió el **status canónico**, escribe `ApplicationStatusNotify.v1` en el outbox (misma
 *    txn). `groupId` opcional se valida: link∈grupo ∧ actor miembro.
 */
@Injectable()
export class ChangeApplicationStatus {
  constructor(
    @Inject(APPLICATION_REPOSITORY)
    private readonly applications: ApplicationRepository,
    @Inject(APPLICATION_LINKS) private readonly links: ApplicationLinks,
    @Inject(APPLICATION_GROUPS) private readonly groups: ApplicationGroups,
    @Inject(APPLICATIONS_CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    private readonly fitScores: ApplicationFitScores,
  ) {}

  async execute(
    userId: string,
    applicationId: string,
    request: ChangeApplicationStatusRequest,
  ): Promise<ApplicationResponse> {
    const current = await this.applications.findOwned(applicationId, userId);
    if (current === null) {
      throw new ApplicationNotFound();
    }
    if (request.groupId !== undefined) {
      await this.assertNotifyGroup(userId, current.linkId, request.groupId);
    }
    const change = changeStatus(
      current,
      {
        status: request.status,
        ...(request.stageLabel === undefined
          ? {}
          : { stageLabel: request.stageLabel }),
        ...(request.appliedAt === undefined
          ? {}
          : { appliedAt: new Date(request.appliedAt) }),
      },
      this.clock.now(),
    );
    if (change.kind === 'unchanged') {
      return await respondWithCard(this.links, this.fitScores, current);
    }
    if (request.version !== current.version) {
      throw new ApplicationConflict();
    }
    const statusChanged = current.status !== change.next.status;
    const shouldNotify =
      current.visibility === 'group' && statusChanged;
    const written = await this.applications.changeStatus(
      current.id,
      userId,
      change.write,
      change.event,
      shouldNotify
        ? async (session: TransactionSession) => {
            await this.outbox.append(
              applicationStatusNotifyEvent({
                applicationId: current.id,
                linkId: current.linkId,
                actorUserId: userId,
                status: change.next.status,
                ...(request.groupId === undefined
                  ? {}
                  : { groupId: request.groupId }),
              }),
              session,
            );
          }
        : undefined,
    );
    if (!written) {
      const reread = await this.applications.findOwned(current.id, userId);
      throw reread === null
        ? new ApplicationNotFound()
        : new ApplicationConflict();
    }
    return await respondWithCard(this.links, this.fitScores, change.next);
  }

  private async assertNotifyGroup(
    userId: string,
    linkId: string,
    groupId: string,
  ): Promise<void> {
    const shared = await this.links.linkIdsSharedIn(groupId, [linkId]);
    if (!shared.has(linkId)) {
      throw new InvalidNotifyGroupId();
    }
    const members = await this.groups.memberIdsOf(groupId);
    if (!members.includes(userId)) {
      throw new InvalidNotifyGroupId();
    }
  }
}
