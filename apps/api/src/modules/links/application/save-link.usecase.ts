import type {
  AlreadyInGroup,
  SaveLinkRequest,
  SaveLinkResponse,
} from '@linkvault/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GroupNotFound } from '../../groups/domain/errors';
import { InvalidShareNote } from '../domain/errors';
import { createShareNote } from '../domain/share-note';
import { toShareNoteView } from './comment.mapper';
import { displayNameIdsOf, toJobLinkSummary, toLinkSharer } from './link.mapper';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from './ports/group-link-repository.port';
import {
  GROUP_MEMBERSHIP,
  type GroupMembership,
  type UserGroup,
} from './ports/group-membership.port';
import {
  JOB_LINK_REPOSITORY,
  type JobLinkRepository,
} from './ports/job-link-repository.port';
import {
  LINK_USER_DIRECTORY,
  type LinkUserDirectory,
} from './ports/link-user-directory.port';
import { LINKS_CLOCK, type Clock } from './ports/clock.port';
import { OUTBOX, type Outbox } from './ports/outbox.port';
import {
  USER_LINK_REPOSITORY,
  type UserLinkRepository,
} from './ports/user-link-repository.port';
import { requireDraft, saveOneLink, type SavedLink } from './save-one-link';

/**
 * `POST /api/links` (spec links/sharing). Con `groupId` el link queda compartido en ese grupo; sin él, solo en la lista
 * privada de quien lo guarda. La vacante, la relación y el evento del outbox se escriben en la misma transacción.
 *
 * `created` dice si la vacante no existía en LinkVault y `shared` si la relación con el destino es nueva: son cosas
 * distintas, y el SPA solo avisa "ya estaba aquí" con la segunda. Un grupo del que no se es miembro y un identificador
 * mal formado responden lo mismo que uno inexistente (`group_not_found`), así que un extraño no puede distinguirlos.
 *
 * Los grupos del usuario se resuelven **una sola vez** y sirven para las dos cosas: comprobar que el destino es suyo y
 * calcular `alreadyInGroups` con una única consulta de relaciones (D4), sin una consulta por grupo.
 *
 * La nota (D3 de group-comments) llega ya normalizada por el contrato y el dominio la vuelve a validar: vacía equivale a
 * no enviarla; con texto exige grupo. Solo se guarda si la relación es nueva: si el link ya estaba, se descarta sin error
 * y la respuesta trae la nota del primero.
 */
@Injectable()
export class SaveLink {
  constructor(
    @Inject(JOB_LINK_REPOSITORY) private readonly links: JobLinkRepository,
    @Inject(GROUP_LINK_REPOSITORY)
    private readonly groupLinks: GroupLinkRepository,
    @Inject(USER_LINK_REPOSITORY)
    private readonly userLinks: UserLinkRepository,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(GROUP_MEMBERSHIP) private readonly membership: GroupMembership,
    @Inject(LINK_USER_DIRECTORY) private readonly directory: LinkUserDirectory,
    @Inject(LINKS_CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    userId: string,
    request: SaveLinkRequest,
  ): Promise<SaveLinkResponse> {
    const groupId = request.groupId;
    const note = createShareNote(request.note, this.clock.now());
    if (note !== null && groupId === undefined) {
      throw new InvalidShareNote();
    }
    const draft = requireDraft(request.url, userId, this.clock.now());
    const myGroups = await this.membership.groupsOf(userId);
    if (groupId !== undefined && !isMemberOf(myGroups, groupId)) {
      throw new GroupNotFound();
    }
    const saved = await saveOneLink(this.writers(), {
      draft,
      userId,
      ...(groupId === undefined ? {} : { groupId }),
      ...(note === null ? {} : { note }),
      now: this.clock.now(),
    });
    return await this.toResponse(saved, myGroups, groupId);
  }

  private writers() {
    return {
      links: this.links,
      groupLinks: this.groupLinks,
      userLinks: this.userLinks,
      outbox: this.outbox,
    };
  }

  private async toResponse(
    saved: SavedLink,
    myGroups: readonly UserGroup[],
    groupId: string | undefined,
  ): Promise<SaveLinkResponse> {
    const inGroup = groupId !== undefined;
    // Una sola consulta para quien compartió y para quien escribió a mano algún campo del preview: compartir una
    // vacante que otro ya corrigió no puede costar una consulta por campo (D4).
    const ids = displayNameIdsOf([saved.link], inGroup ? [saved.sharedBy] : []);
    const names =
      ids.length === 0
        ? new Map<string, string>()
        : await this.directory.displayNamesOf(ids);
    const sharer = inGroup
      ? toLinkSharer(saved.sharedBy, names.get(saved.sharedBy))
      : undefined;
    return {
      link: toJobLinkSummary(saved.link, {
        sharedAt: saved.sharedAt,
        names,
        ...(sharer === undefined ? {} : { sharedBy: sharer }),
        ...(inGroup && saved.note !== undefined
          ? { note: toShareNoteView(saved.note) }
          : {}),
      }),
      created: saved.created,
      shared: saved.shared,
      // Solo interesa cuando ya estaba: es el "lo compartió Ana" del aviso.
      ...(sharer !== undefined && saved.shared === 'already_there'
        ? { sharedBy: sharer }
        : {}),
      alreadyInGroups: await this.alreadyInGroups(
        saved.link.id,
        myGroups,
        groupId,
      ),
    };
  }

  /**
   * Grupos **del propio usuario**, distintos del destino, donde ese link ya estaba. Nunca incluye un grupo ajeno: la
   * lista de candidatos son sus grupos, resueltos al principio de la petición, y las relaciones se leen de una vez.
   */
  private async alreadyInGroups(
    linkId: string,
    myGroups: readonly UserGroup[],
    groupId: string | undefined,
  ): Promise<AlreadyInGroup[]> {
    const candidates = myGroups.filter((group) => group.groupId !== groupId);
    if (candidates.length === 0) {
      return [];
    }
    const withLink = await this.groupLinks.groupsWithLink(
      candidates.map((group) => group.groupId),
      linkId,
    );
    return candidates
      .filter((group) => withLink.has(group.groupId))
      .map((group) => ({ id: group.groupId, name: group.name }));
  }
}

function isMemberOf(groups: readonly UserGroup[], groupId: string): boolean {
  return groups.some((group) => group.groupId === groupId);
}
