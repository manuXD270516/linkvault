import type { GroupSummary } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupFull, InvalidInviteCode, TooManyGroups } from '../domain/errors';
import { isValidInviteCode, normalizeInviteCode } from '../domain/invite-code';
import { hasReachedGroupLimit, isGroupFull } from '../domain/limits';
import { toGroupSummary } from './group.mapper';
import { GROUPS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `POST /api/groups/join` (spec groups/membership). El código se normaliza y su formato lo juzga el dominio: uno mal
 * pegado no llega a la base de datos y responde lo mismo que uno desconocido (D3), así que un extraño no puede saber si
 * un código existe.
 *
 * Unirse es idempotente (D5): si ya era miembro devuelve el grupo con su rol actual sin escribir, incluso si está en el
 * tope de 20 grupos, así que el owner que pega su propio código recibe `owner`. La respuesta nunca lleva el código de
 * invitación, para lo cual basta con que el mapeo sea `toGroupSummary`.
 */
@Injectable()
export class JoinByCode {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUPS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, code: string): Promise<GroupSummary> {
    const inviteCode = normalizeInviteCode(code);
    if (!isValidInviteCode(inviteCode)) {
      throw new InvalidInviteCode();
    }
    const group = await this.groups.findByInviteCode(inviteCode);
    if (group === null) {
      throw new InvalidInviteCode();
    }
    const counts = await this.groups.countMembers([group.id]);
    const memberCount = counts.get(group.id) ?? 0;

    const current = await this.groups.findMembership(group.id, userId);
    if (current !== null) {
      return toGroupSummary(group, current.role, memberCount, current.joinedAt);
    }

    // Primero el límite del grupo y después el del usuario: quien se une a un grupo lleno recibe `group_full` aunque
    // además esté en su tope de grupos. Los dos son antiabuso, no invariantes: la carrera la cierra el índice único (D4).
    if (isGroupFull(memberCount)) {
      throw new GroupFull();
    }
    if (hasReachedGroupLimit(await this.groups.countGroupsOfUser(userId))) {
      throw new TooManyGroups();
    }
    const membership = await this.groups.addMember({
      groupId: group.id,
      userId,
      now: this.clock.now(),
    });
    return toGroupSummary(
      group,
      membership.role,
      memberCount + 1,
      membership.joinedAt,
    );
  }
}
