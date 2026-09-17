import type { GroupDetail } from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { InvalidGroupName, TooManyGroups } from '../domain/errors';
import { isValidGroupName, normalizeGroupName } from '../domain/group';
import { hasReachedGroupLimit } from '../domain/limits';
import { toGroupDetail } from './group.mapper';
import { GROUPS_CLOCK, type Clock } from './ports/clock.port';
import {
  GROUP_REPOSITORY,
  type GroupRepository,
} from './ports/group-repository.port';

/**
 * `POST /api/groups` (spec groups/group-management). El grupo y la membresía `owner` del creador se escriben de forma
 * atómica en el repositorio, así que no puede quedar un grupo sin owner. El límite de 20 grupos se comprueba antes de
 * escribir y no cuenta las membresías huérfanas (D4 y D6). El creador recibe el código de invitación: es el owner.
 */
@Injectable()
export class CreateGroup {
  constructor(
    @Inject(GROUP_REPOSITORY) private readonly groups: GroupRepository,
    @Inject(GROUPS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(userId: string, name: string): Promise<GroupDetail> {
    const normalized = normalizeGroupName(name);
    if (!isValidGroupName(normalized)) {
      throw new InvalidGroupName();
    }
    if (hasReachedGroupLimit(await this.groups.countGroupsOfUser(userId))) {
      throw new TooManyGroups();
    }
    const group = await this.groups.create({
      name: normalized,
      ownerId: userId,
      now: this.clock.now(),
    });
    // Recién creado: el único miembro es su owner.
    return toGroupDetail(group, 'owner', 1, { includeInviteCode: true });
  }
}
