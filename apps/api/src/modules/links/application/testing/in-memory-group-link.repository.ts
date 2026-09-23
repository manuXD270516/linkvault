import type { NewGroupLinkComment } from '../../domain/group-link-comment';
import { isGroupId, isLinkId } from '../../domain/identifier';
import {
  MAX_PUBLIC_SLUG_ATTEMPTS,
  PublicSlugExhausted,
  type PublicShare,
} from '../../domain/public-share';
import type { ShareNote } from '../../domain/share-note';
import type { PublicSlugGenerator } from '../ports/public-slug-generator.port';
import { StubPublicSlugGenerator } from './stub-public-slug.generator';
import type {
  AddedComment,
  CommentsCounters,
  GroupLink,
  GroupLinkRepository,
  ShareInGroupInput,
  SharedGroupLink,
} from '../ports/group-link-repository.port';
import type { LinkListPage, LinkListQuery } from '../ports/link-listing';
import type { TransactionSession } from '../../../../infrastructure/outbox/transaction-session';
import type { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { InMemoryGroupLinkCommentRepository } from './in-memory-group-link-comment.repository';
import { pageOf, type StoredRelation } from './in-memory-pagination';

// Relación grupo–vacante en memoria para tests de application (D10 de job-links). No es un adaptador de producción: el
// real es `MongoGroupLinkRepository`. Impone lo mismo que el índice único `(groupId, linkId)`: un grupo tiene cada link
// una sola vez y quien lo compartió primero no cambia.
//
// Es el **único dueño** de `commentCount` y `commentsRevision`, como `MongoGroupLinkRepository` (D2 de group-comments):
// escribe los comentarios a través del doble de comentarios que recibe. No emula el rollback ni la carrera de dos
// transacciones: eso lo prueban los tests de integración.

interface StoredGroupLink extends StoredRelation {
  readonly groupId: string;
  readonly linkId: string;
  readonly sharedBy: string;
  note?: ShareNote;
  commentCount: number;
  commentsRevision: number;
  publicShare?: PublicShare;
  knowSomeoneUserIds: string[];
}

/** Sesión de mentira de las transacciones de este doble. */
const OWN_SESSION: TransactionSession = Object.freeze({ inMemoryOwner: true });

export class InMemoryGroupLinkRepository implements GroupLinkRepository {
  private readonly relations: StoredGroupLink[] = [];
  private nextId = 1;

  /** Sesión con la que se escribió la última relación: un test comprueba que fue la de la transacción del alta. */
  lastSession: TransactionSession | null = null;
  /** Cuántas veces se preguntó por los grupos que ya tienen un link: lo usa el test que descarta el N+1 (D4). */
  groupsWithLinkCalls = 0;

  /** Llamadas a las lecturas del listado, para el test de las lecturas fijas (D7 de group-comments). */
  listByGroupCalls = 0;
  countByGroupCalls = 0;
  findCalls = 0;

  constructor(
    private readonly links: InMemoryJobLinkRepository,
    readonly comments: InMemoryGroupLinkCommentRepository = new InMemoryGroupLinkCommentRepository(),
    /**
     * El generador de slugs lo consume el **repositorio**, no los casos de uso (D2 de public-preview-share), igual que
     * en el adaptador de Mongo: un choque de slug no es un concepto de aplicación.
     */
    private readonly slugs: PublicSlugGenerator = new StubPublicSlugGenerator(),
  ) {}

  /** Cuántas relaciones hay en total; lo usan los tests del borrado en cascada. */
  get size(): number {
    return this.relations.length;
  }

  share(
    input: ShareInGroupInput,
    session: TransactionSession,
  ): Promise<SharedGroupLink> {
    this.lastSession = session;
    const existing = this.relationOf(input.groupId, input.linkId);
    if (existing !== undefined) {
      return Promise.resolve({ relation: toGroupLink(existing), created: false });
    }
    const relation: StoredGroupLink = {
      relationId: this.nextRelationId(),
      groupId: input.groupId,
      linkId: input.linkId,
      sharedBy: input.sharedBy,
      date: input.sharedAt,
      ...(input.note === undefined ? {} : { note: input.note }),
      commentCount: 0,
      commentsRevision: 0,
      knowSomeoneUserIds: [],
      // La visibilidad por defecto del grupo solo alcanza a la relación **nueva** (D3): el enlace del primero, arriba,
      // no se toca. Como en Mongo, aquí NO se reintenta el slug: la colisión sube y la resuelve quien repita el alta.
      ...(input.publish === true
        ? {
            publicShare: {
              slug: this.freeSlugOrThrow(1),
              publishedBy: input.sharedBy,
              publishedAt: input.sharedAt,
            },
          }
        : {}),
    };
    this.relations.push(relation);
    return Promise.resolve({ relation: toGroupLink(relation), created: true });
  }

  find(groupId: string, linkId: string): Promise<GroupLink | null> {
    this.findCalls += 1;
    const relation = this.relationOf(groupId, linkId);
    return Promise.resolve(relation ? toGroupLink(relation) : null);
  }

  relationsOfLink(linkId: string): Promise<GroupLink[]> {
    if (!isLinkId(linkId)) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      this.relations
        .filter((relation) => relation.linkId === linkId)
        .map(toGroupLink),
    );
  }

  async listByGroup(
    groupId: string,
    query: LinkListQuery,
  ): Promise<LinkListPage> {
    this.listByGroupCalls += 1;
    if (!isGroupId(groupId)) {
      return { items: [] };
    }
    return await pageOf(
      this.relations.filter((relation) => relation.groupId === groupId),
      query,
      this.links,
      (relation) => relation.sharedBy,
      (relation) => ({
        ...(relation.note === undefined ? {} : { note: relation.note }),
        commentCount: relation.commentCount,
        commentsRevision: relation.commentsRevision,
        // Viaja en la misma consulta de la relación: el listado NO cuesta una lectura más por pintar el interruptor.
        ...(relation.publicShare === undefined
          ? {}
          : { publicShare: { ...relation.publicShare } }),
        knowSomeoneUserIds: [...relation.knowSomeoneUserIds],
      }),
    );
  }

  countByGroup(groupId: string): Promise<number> {
    this.countByGroupCalls += 1;
    if (!isGroupId(groupId)) {
      return Promise.resolve(0);
    }
    return Promise.resolve(
      this.relations.filter((relation) => relation.groupId === groupId).length,
    );
  }

  groupsWithLink(
    groupIds: readonly string[],
    linkId: string,
  ): Promise<Set<string>> {
    this.groupsWithLinkCalls += 1;
    const wanted = new Set(groupIds.filter((groupId) => isGroupId(groupId)));
    const found = new Set<string>();
    if (!isLinkId(linkId)) {
      return Promise.resolve(found);
    }
    for (const relation of this.relations) {
      if (relation.linkId === linkId && wanted.has(relation.groupId)) {
        found.add(relation.groupId);
      }
    }
    return Promise.resolve(found);
  }

  /** Cuántas veces se preguntó qué links están en un grupo: lo usa el test de las lecturas fijas (D6). */
  linkIdsInCalls = 0;

  linkIdsIn(groupId: string, linkIds: readonly string[]): Promise<Set<string>> {
    this.linkIdsInCalls += 1;
    const wanted = new Set(linkIds.filter((linkId) => isLinkId(linkId)));
    const found = new Set<string>();
    if (!isGroupId(groupId)) {
      return Promise.resolve(found);
    }
    for (const relation of this.relations) {
      if (relation.groupId === groupId && wanted.has(relation.linkId)) {
        found.add(relation.linkId);
      }
    }
    return Promise.resolve(found);
  }

  async removeWithComments(groupId: string, linkId: string): Promise<boolean> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return false;
    }
    this.relations.splice(this.relations.indexOf(relation), 1);
    await this.comments.deleteByRelation(groupId, linkId, OWN_SESSION);
    return true;
  }

  async deleteByGroup(
    groupId: string,
    session: TransactionSession,
  ): Promise<number> {
    this.lastSession = session;
    await this.comments.deleteByGroup(groupId, session);
    return this.deleteWhere((relation) => relation.groupId === groupId);
  }

  async addComment(comment: NewGroupLinkComment): Promise<AddedComment | null> {
    const relation = this.relationOf(comment.groupId, comment.linkId);
    if (relation === undefined) {
      return null;
    }
    relation.commentCount += 1;
    relation.commentsRevision += 1;
    const stored = await this.comments.insert(comment, OWN_SESSION);
    return { comment: stored, counters: countersOf(relation) };
  }

  async removeComment(
    groupId: string,
    linkId: string,
    commentId: string,
  ): Promise<CommentsCounters | null> {
    const relation = this.relationOf(groupId, linkId);
    if (
      relation === undefined ||
      !(await this.comments.deleteOne(groupId, linkId, commentId, OWN_SESSION))
    ) {
      return null;
    }
    relation.commentCount -= 1;
    relation.commentsRevision += 1;
    return countersOf(relation);
  }

  /** Mismo comportamiento que el adaptador de Mongo: idempotente y con el slug sorteado aquí dentro (D2). */
  publish(
    groupId: string,
    linkId: string,
    publishedBy: string,
    now: Date,
  ): Promise<PublicShare | null> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return Promise.resolve(null);
    }
    if (relation.publicShare !== undefined) {
      return Promise.resolve({ ...relation.publicShare });
    }
    relation.publicShare = {
      slug: this.freeSlugOrThrow(MAX_PUBLIC_SLUG_ATTEMPTS),
      publishedBy,
      publishedAt: now,
    };
    return Promise.resolve({ ...relation.publicShare });
  }

  /** Quema el slug: volver a publicar genera otro y la URL vieja deja de existir. */
  unpublish(groupId: string, linkId: string): Promise<boolean> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return Promise.resolve(false);
    }
    delete relation.publicShare;
    return Promise.resolve(true);
  }

  /** Cuántas veces se buscó por slug: lo usa el test de las dos lecturas de la página pública (D7). */
  findByPublicSlugCalls = 0;

  findByPublicSlug(slug: string): Promise<GroupLink | null> {
    this.findByPublicSlugCalls += 1;
    const relation = this.relations.find(
      // Comparación exacta y sensible a mayúsculas: un slug con otra caja es un slug que no existe (D2).
      (candidate) => candidate.publicShare?.slug === slug,
    );
    return Promise.resolve(relation ? toGroupLink(relation) : null);
  }

  clearNote(groupId: string, linkId: string): Promise<boolean> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return Promise.resolve(false);
    }
    delete relation.note;
    return Promise.resolve(true);
  }

  setKnowSomeone(
    groupId: string,
    linkId: string,
    userId: string,
    flagged: boolean,
  ): Promise<{ readonly flaggedByMe: boolean; readonly count: number } | null> {
    const relation = this.relationOf(groupId, linkId);
    if (relation === undefined) {
      return Promise.resolve(null);
    }
    if (flagged) {
      if (!relation.knowSomeoneUserIds.includes(userId)) {
        relation.knowSomeoneUserIds.push(userId);
      }
    } else {
      relation.knowSomeoneUserIds = relation.knowSomeoneUserIds.filter(
        (id) => id !== userId,
      );
    }
    return Promise.resolve({
      flaggedByMe: relation.knowSomeoneUserIds.includes(userId),
      count: relation.knowSomeoneUserIds.length,
    });
  }

  /** Alta directa para preparar un test, sin pasar por el caso de uso. */
  async seed(input: ShareInGroupInput): Promise<GroupLink> {
    const { relation } = await this.share(input, {});
    return relation;
  }

  private relationOf(
    groupId: string,
    linkId: string,
  ): StoredGroupLink | undefined {
    if (!isGroupId(groupId) || !isLinkId(linkId)) {
      return undefined;
    }
    return this.relations.find(
      (relation) => relation.groupId === groupId && relation.linkId === linkId,
    );
  }

  private deleteWhere(matches: (relation: StoredGroupLink) => boolean): number {
    let deleted = 0;
    for (let index = this.relations.length - 1; index >= 0; index -= 1) {
      const relation = this.relations[index];
      if (relation !== undefined && matches(relation)) {
        this.relations.splice(index, 1);
        deleted += 1;
      }
    }
    return deleted;
  }

  /**
   * Slug libre entre los ya usados, con el mismo número de intentos que el adaptador de Mongo. Aquí la unicidad se
   * comprueba en memoria; allí la garantiza el índice único parcial y el choque llega como un `E11000`.
   */
  private freeSlugOrThrow(attempts: number): string {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const slug = this.slugs.next();
      const taken = this.relations.some(
        (relation) => relation.publicShare?.slug === slug,
      );
      if (!taken) {
        return slug;
      }
    }
    throw new PublicSlugExhausted();
  }

  private nextRelationId(): string {
    const id = this.nextId.toString(16).padStart(24, '0');
    this.nextId += 1;
    return id;
  }
}

function toGroupLink(relation: StoredGroupLink): GroupLink {
  return {
    groupId: relation.groupId,
    linkId: relation.linkId,
    sharedBy: relation.sharedBy,
    sharedAt: relation.date,
    ...(relation.note === undefined ? {} : { note: relation.note }),
    commentCount: relation.commentCount,
    commentsRevision: relation.commentsRevision,
    ...(relation.publicShare === undefined
      ? {}
      : { publicShare: { ...relation.publicShare } }),
    knowSomeoneUserIds: [...relation.knowSomeoneUserIds],
  };
}

function countersOf(relation: StoredGroupLink): CommentsCounters {
  return {
    count: relation.commentCount,
    revision: relation.commentsRevision,
    sharedAt: relation.date,
  };
}
