import { linkPageSchema, type SaveLinkResponse } from '@linkvault/shared';
import mongoose from 'mongoose';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import {
  GROUP_LINK_REPOSITORY,
  type GroupLinkRepository,
} from '../application/ports/group-link-repository.port';
import { GROUP_LINK_COMMENTS_COLLECTION } from '../infrastructure/group-link-comment.schemas';
import {
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
  USER_LINKS_COLLECTION,
} from '../infrastructure/link.schemas';
import { MongoGroupLinkCommentRepository } from '../infrastructure/mongo-group-link-comment.repository';

// Borrado de grupo en cascada (tarea 6.2 de job-links): `LinksModule` registra su limpieza en `GroupDeletionHooks`, así
// que borrar un grupo se lleva sus `GroupLink` dentro de la misma transacción y nunca las vacantes.

const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const COMPUTRABAJO =
  'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718';

describe('deleting a group with links', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp('links-group-deletion-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  async function save(
    member: TestMember,
    url: string,
    groupId?: string,
  ): Promise<SaveLinkResponse> {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: { url, ...(groupId === undefined ? {} : { groupId }) },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>();
  }

  function relationsOf(groupId: string): Promise<number> {
    return http.connection
      .collection(GROUP_LINKS_COLLECTION)
      .countDocuments({ groupId: new mongoose.Types.ObjectId(groupId) });
  }

  it('El borrado no destruye las vacantes', async () => {
    const doomed = await http.createGroup(ana, 'Se borra');
    const other = await http.createGroup(ana, 'Se queda');
    const { link } = await save(ana, JOB_PAGE, doomed.id);
    await save(ana, JOB_PAGE, other.id);
    await save(ana, COMPUTRABAJO, doomed.id);
    expect(await relationsOf(doomed.id)).toBe(2);

    const response = await http.request('DELETE', `/api/groups/${doomed.id}`, {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(204);
    // Cero relaciones del grupo borrado, y ninguna vacante perdida.
    expect(await relationsOf(doomed.id)).toBe(0);
    expect(
      await http.connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ _id: new mongoose.Types.ObjectId(link.id) }),
    ).toBe(1);

    const remaining = await http.request(
      'GET',
      `/api/groups/${other.id}/links`,
      { authorization: ana.authorization },
    );
    expect(
      linkPageSchema.parse(remaining.json()).items.map((item) => item.id),
    ).toEqual([link.id]);
  });

  it('leaves the relations of the other groups and the private lists alone', async () => {
    const doomed = await http.createGroup(ana, 'Otro que se borra');
    const kept = await http.createGroup(ana, 'Otro que se queda');
    await save(ana, 'https://empresa.example/careers/cascada-1', doomed.id);
    await save(ana, 'https://empresa.example/careers/cascada-2', kept.id);
    await save(ana, 'https://empresa.example/careers/cascada-3');

    await http.request('DELETE', `/api/groups/${doomed.id}`, {
      authorization: ana.authorization,
    });

    expect(await relationsOf(doomed.id)).toBe(0);
    expect(await relationsOf(kept.id)).toBe(1);
    expect(
      await http.connection
        .collection(USER_LINKS_COLLECTION)
        .countDocuments({ userId: new mongoose.Types.ObjectId(ana.userId) }),
    ).toBe(1);
  });

  it('does not touch the links of a group that could not be deleted', async () => {
    const stranger = await http.authenticated('Extraño');
    const theirs = await http.createGroup(stranger, 'De otro');
    await save(stranger, 'https://empresa.example/careers/ajeno', theirs.id);

    const response = await http.request('DELETE', `/api/groups/${theirs.id}`, {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(404);
    expect(await relationsOf(theirs.id)).toBe(1);
  });
});

// El borrado se lleva los comentarios (tarea 2.12 de group-comments): `GroupLinksDeletionHook` llama a
// `deleteByGroup`, que borra antes los comentarios del grupo con la misma sesión de `groups`.

/** Adaptador de comentarios cuyo borrado por grupo falla, para comprobar que no se borra nada. */
class FailingGroupCommentDeletion extends MongoGroupLinkCommentRepository {
  override deleteByGroup(): Promise<number> {
    return Promise.reject(new Error('Forced failure deleting comments'));
  }
}

async function comment(
  app: LinksTestApp,
  groupId: string,
  linkId: string,
  authorId: string,
): Promise<void> {
  const groupLinks = app.app.get<GroupLinkRepository>(GROUP_LINK_REPOSITORY, {
    strict: false,
  });
  const added = await groupLinks.addComment({
    groupId,
    linkId,
    authorId,
    text: 'Piden inglés C1',
    createdAt: new Date(),
  });
  expect(added).not.toBeNull();
}

function commentsOf(app: LinksTestApp, groupId: string): Promise<number> {
  return app.connection
    .collection(GROUP_LINK_COMMENTS_COLLECTION)
    .countDocuments({ groupId: new mongoose.Types.ObjectId(groupId) });
}

async function saveIn(
  app: LinksTestApp,
  member: TestMember,
  url: string,
  groupId: string,
): Promise<string> {
  const response = await app.request('POST', '/api/links', {
    authorization: member.authorization,
    body: { url, groupId },
  });
  expect(response.statusCode).toBe(201);
  return response.json<SaveLinkResponse>().link.id;
}

describe('deleting a group with comments', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp('links-gd-comments', getMongoTestUri());
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  it('Grupo borrado sin comentarios huérfanos', async () => {
    const doomed = await http.createGroup(ana, 'Con comentarios');
    const first = await saveIn(http, ana, 'https://empresa.example/careers/c-1', doomed.id);
    const second = await saveIn(http, ana, 'https://empresa.example/careers/c-2', doomed.id);
    for (const linkId of [first, first, first, second, second]) {
      await comment(http, doomed.id, linkId, ana.userId);
    }
    expect(await commentsOf(http, doomed.id)).toBe(5);

    const response = await http.request('DELETE', `/api/groups/${doomed.id}`, {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(204);
    expect(await commentsOf(http, doomed.id)).toBe(0);
  });

  it('Los comentarios de otro grupo siguen', async () => {
    const doomed = await http.createGroup(ana, 'A');
    const kept = await http.createGroup(ana, 'B');
    const url = 'https://empresa.example/careers/c-3';
    const linkId = await saveIn(http, ana, url, doomed.id);
    await saveIn(http, ana, url, kept.id);
    await comment(http, doomed.id, linkId, ana.userId);
    await comment(http, kept.id, linkId, ana.userId);

    await http.request('DELETE', `/api/groups/${doomed.id}`, {
      authorization: ana.authorization,
    });

    expect(await commentsOf(http, doomed.id)).toBe(0);
    expect(await commentsOf(http, kept.id)).toBe(1);
  });
});

describe('deleting a group when its comments cannot be deleted', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp(
      'links-gd-failing',
      getMongoTestUri(),
      { commentRepository: FailingGroupCommentDeletion },
    );
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  it('Si falla la limpieza no se borra nada', async () => {
    const group = await http.createGroup(ana, 'No se borra');
    const beto = await http.authenticated('Beto');
    await http.join(beto, group);
    const linkId = await saveIn(http, ana, 'https://empresa.example/careers/c-4', group.id);
    await comment(http, group.id, linkId, beto.userId);

    const response = await http.request('DELETE', `/api/groups/${group.id}`, {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(500);
    const detail = await http.request('GET', `/api/groups/${group.id}`, {
      authorization: ana.authorization,
    });
    expect(detail.statusCode).toBe(200);
    const members = await http.request('GET', `/api/groups/${group.id}/members`, {
      authorization: ana.authorization,
    });
    expect(members.statusCode).toBe(200);
    expect(members.body).toContain(beto.userId);
    expect(await relationsOfGroup(http, group.id)).toBe(1);
    expect(await commentsOf(http, group.id)).toBe(1);
  });
});

function relationsOfGroup(app: LinksTestApp, groupId: string): Promise<number> {
  return app.connection
    .collection(GROUP_LINKS_COLLECTION)
    .countDocuments({ groupId: new mongoose.Types.ObjectId(groupId) });
}
