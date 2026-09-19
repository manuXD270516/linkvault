import { DeleteGroupLinkComment } from '../delete-group-link-comment.usecase';
import { ListGroupLinkComments } from '../list-group-link-comments.usecase';
import { ListGroupLinks } from '../list-group-links.usecase';
import { PostGroupLinkComment } from '../post-group-link-comment.usecase';
import { RemoveGroupLink } from '../remove-group-link.usecase';
import { RemoveShareNote } from '../remove-share-note.usecase';
import { SaveLink } from '../save-link.usecase';
import { InMemoryGroupLinkRepository } from './in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './in-memory-user-link.repository';
import { jobLinkDraft, objectId } from './link-fixtures';
import {
  InMemoryCommentsChangedPublisher,
  InMemoryGroupMembership,
  InMemoryLinkLimiter,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
} from './links-test-doubles';

// Arnés de los casos de uso de comentarios y notas (grupo 3 de group-comments): los dobles en memoria cableados como en
// `LinksModule`, con Ana propietaria del grupo, Beto y Carla miembros y un extraño fuera.

export const ANA = objectId(1);
export const BETO = objectId(2);
export const CARLA = objectId(3);
export const STRANGER = objectId(4);
export const BACKEND = objectId(10);
export const FRONTEND = objectId(11);

export class CommentsHarness {
  readonly clock = new MovableClock(new Date('2026-09-19T10:00:00.000Z'));
  readonly links = new InMemoryJobLinkRepository();
  readonly groupLinks = new InMemoryGroupLinkRepository(this.links);
  readonly comments = this.groupLinks.comments;
  readonly userLinks = new InMemoryUserLinkRepository(this.links);
  readonly membership = new InMemoryGroupMembership()
    .withMember(BACKEND, ANA, 'owner')
    .withMember(BACKEND, BETO)
    .withMember(BACKEND, CARLA)
    .withMember(FRONTEND, BETO, 'owner', 'Frontend')
    .withMember(FRONTEND, ANA, 'member', 'Frontend');
  readonly directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto')
    .set(CARLA, 'Carla')
    .set(STRANGER, 'Extraño');
  readonly limiter = new InMemoryLinkLimiter();
  readonly publisher = new InMemoryCommentsChangedPublisher();

  readonly post = new PostGroupLinkComment(
    this.groupLinks,
    this.comments,
    this.membership,
    this.directory,
    this.limiter,
    this.publisher,
    this.clock,
  );
  readonly remove = new DeleteGroupLinkComment(
    this.groupLinks,
    this.comments,
    this.membership,
    this.directory,
    this.publisher,
  );
  readonly thread = new ListGroupLinkComments(
    this.groupLinks,
    this.comments,
    this.membership,
    this.directory,
  );
  readonly listGroupLinks = new ListGroupLinks(
    this.groupLinks,
    this.comments,
    this.membership,
    this.directory,
  );
  readonly removeNote = new RemoveShareNote(this.groupLinks, this.membership);
  readonly removeGroupLink = new RemoveGroupLink(
    this.groupLinks,
    this.membership,
  );
  readonly saveLink = new SaveLink(
    this.links,
    this.groupLinks,
    this.userLinks,
    new InMemoryOutbox(),
    this.membership,
    this.directory,
    this.clock,
  );

  /** Vacante guardada y compartida en el grupo por `sharedBy`, con nota opcional; devuelve su id. */
  async shared(
    groupId: string,
    sharedBy: string,
    url = 'https://www.linkedin.com/jobs/view/3811111111/',
    note?: string,
  ): Promise<string> {
    const response = await this.saveLink.execute(sharedBy, {
      url,
      groupId,
      ...(note === undefined ? {} : { note }),
    });
    return response.link.id;
  }

  /** Vacante que existe pero no está compartida en ningún grupo. */
  unshared(url = 'https://www.linkedin.com/jobs/view/3899999999/'): string {
    return this.links.seed(jobLinkDraft(url)).id;
  }

  /** Comenta y avanza el reloj un minuto, para que cada comentario tenga su fecha. */
  async comment(
    userId: string,
    groupId: string,
    linkId: string,
    text = 'Piden inglés C1',
  ) {
    const response = await this.post.execute(userId, groupId, linkId, {
      text,
    });
    this.clock.advance(60_000);
    return response;
  }
}
