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
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
  USER_LINKS_COLLECTION,
} from '../infrastructure/link.schemas';

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
