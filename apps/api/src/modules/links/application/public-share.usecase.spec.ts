import { beforeEach, describe, expect, it } from 'vitest';
import {
  CommentsGroupNotFound,
  PublicShareForbidden,
  PublicShareNotFound,
} from '../domain/errors';
import { isValidPublicSlug } from '../domain/public-slug';
import { ListGroupLinks } from './list-group-links.usecase';
import { PublishGroupLink } from './publish-group-link.usecase';
import { SaveLink } from './save-link.usecase';
import { InMemoryGroupLinkRepository } from './testing/in-memory-group-link.repository';
import { InMemoryJobLinkRepository } from './testing/in-memory-job-link.repository';
import { InMemoryUserLinkRepository } from './testing/in-memory-user-link.repository';
import { objectId } from './testing/link-fixtures';
import {
  InMemoryGroupMembership,
  InMemoryLinkUserDirectory,
  InMemoryOutbox,
  MovableClock,
  TestPublicUrls,
} from './testing/links-test-doubles';
import { UnpublishGroupLink } from './unpublish-group-link.usecase';

// Interruptor del enlace público (tareas 4.1, 4.2 y 4.6 de public-preview-share), con los dobles en memoria. El slug y
// su reintento viven en el repositorio (D2): aquí solo se prueba el orden de las comprobaciones y la idempotencia.

const ANA = objectId(1);
const BETO = objectId(2);
const CARLA = objectId(3);
const STRANGER = objectId(4);
const BACKEND = objectId(10);
const PRIVATE_GROUP = objectId(11);
const UNKNOWN_GROUP = objectId(99);
const MALFORMED = 'no-es-un-id';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const OTHER_JOB = 'https://www.linkedin.com/jobs/view/3822222222/';

let clock: MovableClock;
let links: InMemoryJobLinkRepository;
let groupLinks: InMemoryGroupLinkRepository;
let membership: InMemoryGroupMembership;
let saveLink: SaveLink;
let publish: PublishGroupLink;
let unpublish: UnpublishGroupLink;
let listGroupLinks: ListGroupLinks;

/** Las URLs públicas de un test: los mismos orígenes que `.env.example`. */
const urls = new TestPublicUrls();

beforeEach(() => {
  clock = new MovableClock();
  links = new InMemoryJobLinkRepository();
  groupLinks = new InMemoryGroupLinkRepository(links);
  const directory = new InMemoryLinkUserDirectory()
    .set(ANA, 'Ana')
    .set(BETO, 'Beto')
    .set(CARLA, 'Carla');
  membership = new InMemoryGroupMembership()
    // Ana es la propietaria; Beto y Carla, miembros. El grupo privado no publica lo que entra.
    .withGroup(BACKEND, 'Backend Bolivia', 'private')
    .withMember(BACKEND, ANA, 'owner')
    .withMember(BACKEND, BETO)
    .withMember(BACKEND, CARLA)
    .withGroup(PRIVATE_GROUP, 'Solo nosotros', 'private')
    .withMember(PRIVATE_GROUP, ANA, 'owner');
  saveLink = new SaveLink(
    links,
    groupLinks,
    new InMemoryUserLinkRepository(links),
    new InMemoryOutbox(),
    membership,
    directory,
    urls,
    clock,
  );
  publish = new PublishGroupLink(groupLinks, membership, urls, clock);
  unpublish = new UnpublishGroupLink(groupLinks, membership);
  listGroupLinks = new ListGroupLinks(
    groupLinks,
    groupLinks.comments,
    membership,
    directory,
    urls,
  );
});

/** Comparte la vacante en el grupo y devuelve su identificador. */
async function shared(sharedBy: string, url = JOB_PAGE): Promise<string> {
  const response = await saveLink.execute(sharedBy, {
    url,
    groupId: BACKEND,
  });
  return response.link.id;
}

describe('PublishGroupLink', () => {
  it('Quien compartió publica', async () => {
    const linkId = await shared(BETO);

    const published = await publish.execute(BETO, BACKEND, linkId);

    expect(isValidPublicSlug(published.slug)).toBe(true);
    expect(published.url).toBe(`http://localhost:3000/p/${published.slug}`);
    expect(published.publishedAt).toBe(clock.now().toISOString());
  });

  it('El propietario publica un link ajeno', async () => {
    const linkId = await shared(BETO);

    await expect(publish.execute(ANA, BACKEND, linkId)).resolves.toMatchObject({
      slug: expect.any(String),
    });
  });

  it('Otro miembro no publica', async () => {
    const linkId = await shared(BETO);

    await expect(publish.execute(CARLA, BACKEND, linkId)).rejects.toBeInstanceOf(
      PublicShareForbidden,
    );
    await expect(
      groupLinks.find(BACKEND, linkId),
    ).resolves.not.toHaveProperty('publicShare');
  });

  it('Publicar dos veces no cambia el enlace', async () => {
    const linkId = await shared(ANA);
    const first = await publish.execute(ANA, BACKEND, linkId);

    clock.advance(60_000);

    await expect(publish.execute(ANA, BACKEND, linkId)).resolves.toEqual(first);
  });

  it('Extraño no toca el interruptor', async () => {
    const linkId = await shared(ANA);

    for (const groupId of [BACKEND, UNKNOWN_GROUP, MALFORMED]) {
      await expect(
        publish.execute(STRANGER, groupId, linkId),
      ).rejects.toBeInstanceOf(CommentsGroupNotFound);
    }
  });

  it.each([
    ['un link que no está en el grupo', () => objectId(77)],
    ['un identificador mal formado', () => MALFORMED],
  ])('Relación que no existe: %s', async (_case, of) => {
    await expect(
      publish.execute(ANA, BACKEND, of()),
    ).rejects.toBeInstanceOf(PublicShareNotFound);
  });

  it('Relación que desaparece entre la comprobación y la escritura', async () => {
    const linkId = await shared(ANA);
    // Entre `find` y `publish` otro quita el link del grupo: el caso de uso responde `link_not_found`, no un 500.
    const vanishing = {
      ...groupLinks,
      find: groupLinks.find.bind(groupLinks),
      publish: () => Promise.resolve(null),
    };
    const publishing = new PublishGroupLink(
      vanishing as unknown as InMemoryGroupLinkRepository,
      membership,
      urls,
      clock,
    );

    await expect(
      publishing.execute(ANA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(PublicShareNotFound);
  });
});

describe('UnpublishGroupLink', () => {
  it('Despublicar quema el enlace', async () => {
    const linkId = await shared(ANA);
    const first = await publish.execute(ANA, BACKEND, linkId);

    await expect(
      unpublish.execute(ANA, BACKEND, linkId),
    ).resolves.toBeUndefined();

    await expect(groupLinks.findByPublicSlug(first.slug)).resolves.toBeNull();
    const again = await publish.execute(ANA, BACKEND, linkId);
    expect(again.slug).not.toBe(first.slug);
  });

  it('Despublicar lo que no estaba publicado', async () => {
    const linkId = await shared(ANA);

    await expect(
      unpublish.execute(ANA, BACKEND, linkId),
    ).resolves.toBeUndefined();
  });

  it('Sin permiso aunque ya esté publicado', async () => {
    const linkId = await shared(BETO);
    const published = await publish.execute(BETO, BACKEND, linkId);

    await expect(
      publish.execute(CARLA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(PublicShareForbidden);
    await expect(
      unpublish.execute(CARLA, BACKEND, linkId),
    ).rejects.toBeInstanceOf(PublicShareForbidden);

    await expect(
      groupLinks.findByPublicSlug(published.slug),
    ).resolves.not.toBeNull();
  });

  it('Extraño no toca el interruptor', async () => {
    const linkId = await shared(ANA);

    await expect(
      unpublish.execute(STRANGER, BACKEND, linkId),
    ).rejects.toBeInstanceOf(CommentsGroupNotFound);
  });
});

describe('ListGroupLinks con enlace público', () => {
  it('Enlace público en el listado', async () => {
    const published = await shared(ANA);
    clock.advance(60_000);
    const plain = await shared(ANA, OTHER_JOB);
    const share = await publish.execute(ANA, BACKEND, published);

    const page = await listGroupLinks.execute(BETO, BACKEND, { limit: 20 });

    expect(
      page.items.find((item) => item.id === published)?.publicShare,
    ).toEqual(share);
    expect(
      page.items.find((item) => item.id === plain)?.publicShare,
    ).toBeUndefined();
  });

  it('El listado no cuesta más lecturas', async () => {
    for (let index = 0; index < 20; index += 1) {
      clock.advance(1000);
      const linkId = await shared(
        ANA,
        `https://www.linkedin.com/jobs/view/38111111${String(index).padStart(2, '0')}/`,
      );
      await publish.execute(ANA, BACKEND, linkId);
    }
    const before = {
      list: groupLinks.listByGroupCalls,
      count: groupLinks.countByGroupCalls,
      bySlug: groupLinks.findByPublicSlugCalls,
    };

    const page = await listGroupLinks.execute(ANA, BACKEND, { limit: 20 });

    expect(page.items).toHaveLength(20);
    expect(page.items.every((item) => item.publicShare !== undefined)).toBe(
      true,
    );
    // Ni una lectura más que con dos links sin publicar: el enlace viaja en la misma consulta de la relación.
    expect(groupLinks.listByGroupCalls).toBe(before.list + 1);
    expect(groupLinks.countByGroupCalls).toBe(before.count + 1);
    expect(groupLinks.findByPublicSlugCalls).toBe(before.bySlug);
  });
});
