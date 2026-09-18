import { linkPageSchema, type GroupDetail, type SaveLinkResponse } from '@linkvault/shared';
import mongoose from 'mongoose';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { JOB_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// `DELETE /api/groups/:id/links/:linkId` y `DELETE /api/links/mine/:linkId` (tarea 5.9 de job-links).

const MALFORMED_ID = 'no-es-un-id';
const UNKNOWN_ID = new mongoose.Types.ObjectId().toHexString();
const VIDEO = 'https://video.example/watch?v=abc';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';

describe('removing links', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let stranger: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp('links-remove-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    stranger = await http.authenticated('Extraño');
  });

  afterAll(async () => {
    await http.close();
  });

  async function groupOf(owner: TestMember, name: string, ...members: TestMember[]) {
    const group = await http.createGroup(owner, name);
    for (const member of members) {
      await http.join(member, group);
    }
    return group;
  }

  async function save(
    member: TestMember,
    url: string,
    group?: GroupDetail,
  ): Promise<SaveLinkResponse> {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: { url, ...(group === undefined ? {} : { groupId: group.id }) },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>();
  }

  function removeFromGroup(
    member: TestMember,
    groupId: string,
    linkId: string,
  ) {
    return http.request('DELETE', `/api/groups/${groupId}/links/${linkId}`, {
      authorization: member.authorization,
    });
  }

  async function linksOf(member: TestMember, groupId: string) {
    const response = await http.request('GET', `/api/groups/${groupId}/links`, {
      authorization: member.authorization,
    });
    return linkPageSchema.parse(response.json());
  }

  it('Quitar lo que no era una oferta', async () => {
    const group = await groupOf(ana, 'Con un vídeo', beto);
    const { link } = await save(beto, VIDEO, group);

    const response = await removeFromGroup(beto, group.id, link.id);

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe('');
    expect((await linksOf(ana, group.id)).items).toEqual([]);
    // La vacante sigue existiendo: quitar es de la relación, nunca del link.
    expect(
      await http.connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ _id: new mongoose.Types.ObjectId(link.id) }),
    ).toBe(1);
  });

  it('El owner limpia el grupo', async () => {
    const group = await groupOf(ana, 'Limpieza del owner', beto);
    const { link } = await save(beto, VIDEO, group);

    const response = await removeFromGroup(ana, group.id, link.id);

    expect(response.statusCode).toBe(204);
    expect((await linksOf(ana, group.id)).total).toBe(0);
  });

  it('Un miembro no quita lo de otro', async () => {
    const group = await groupOf(ana, 'Sin permiso', beto);
    const { link } = await save(ana, JOB_PAGE, group);

    const response = await removeFromGroup(beto, group.id, link.id);

    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({
      code: 'forbidden',
      message: 'Not allowed',
    });
    expect((await linksOf(beto, group.id)).total).toBe(1);
  });

  it('Quitar no destruye la vacante', async () => {
    const first = await groupOf(ana, 'Primero');
    const second = await groupOf(ana, 'Segundo');
    const { link } = await save(ana, JOB_PAGE, first);
    await save(ana, JOB_PAGE, second);

    expect((await removeFromGroup(ana, first.id, link.id)).statusCode).toBe(204);

    expect((await linksOf(ana, first.id)).total).toBe(0);
    expect((await linksOf(ana, second.id)).items.map((item) => item.id)).toEqual(
      [link.id],
    );
  });

  it('answers 404 group_not_found to somebody who is not a member', async () => {
    const group = await groupOf(ana, 'Ajeno');
    const { link } = await save(ana, JOB_PAGE, group);

    const foreign = await removeFromGroup(stranger, group.id, link.id);
    const malformed = await removeFromGroup(stranger, MALFORMED_ID, link.id);

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'group_not_found',
      message: 'Group not found',
    });
    expect(malformed.json()).toEqual(foreign.json());
  });

  it('answers 404 link_not_found for a link that is not in that group', async () => {
    const group = await groupOf(ana, 'Sin ese link');

    const unknown = await removeFromGroup(ana, group.id, UNKNOWN_ID);
    const malformed = await removeFromGroup(ana, group.id, MALFORMED_ID);

    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({
      code: 'link_not_found',
      message: 'Link not found',
    });
    expect(malformed.json()).toEqual(unknown.json());
  });

  it('removes a link from the private list and leaves the vacancy alone', async () => {
    const carla = await http.authenticated('Carla');
    const { link } = await save(carla, VIDEO);

    const response = await http.request(
      'DELETE',
      `/api/links/mine/${link.id}`,
      { authorization: carla.authorization },
    );

    expect(response.statusCode).toBe(204);
    const mine = await http.request('GET', '/api/links/mine', {
      authorization: carla.authorization,
    });
    expect(linkPageSchema.parse(mine.json()).total).toBe(0);
    expect(
      await http.connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ _id: new mongoose.Types.ObjectId(link.id) }),
    ).toBe(1);
  });

  it('answers 404 link_not_found for a private link of somebody else', async () => {
    const dani = await http.authenticated('Dani');
    const { link } = await save(dani, JOB_PAGE);

    const other = await http.request('DELETE', `/api/links/mine/${link.id}`, {
      authorization: ana.authorization,
    });
    const malformed = await http.request(
      'DELETE',
      `/api/links/mine/${MALFORMED_ID}`,
      { authorization: dani.authorization },
    );

    expect(other.statusCode).toBe(404);
    expect(other.json()).toEqual({
      code: 'link_not_found',
      message: 'Link not found',
    });
    expect(malformed.json()).toEqual(other.json());
  });
});
