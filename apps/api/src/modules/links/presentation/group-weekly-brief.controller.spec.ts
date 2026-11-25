import {
  apiErrorResponseSchema,
  groupWeeklyBriefResponseSchema,
  isoWeekKey,
  previousWeekKey,
  type SaveLinkResponse,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';

// `GET /api/groups/:id/weekly-brief` (tarea 4.4 de group-weekly-brief): la respuesta sale validada contra el contrato
// compartido; el documento lo escribe el worker, aquí se inserta a mano con la forma que deja `toDocument`.

const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const COMPUTRABAJO =
  'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718';

describe('GET /api/groups/:id/weekly-brief', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp(
      'links-weekly-brief-http',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
  });

  afterAll(async () => {
    await http.close();
  });

  async function save(url: string, groupId: string): Promise<string> {
    const response = await http.request('POST', '/api/links', {
      authorization: ana.authorization,
      body: { url, groupId },
    });
    expect(response.statusCode).toBe(201);
    return response.json<SaveLinkResponse>().link.id;
  }

  function get(groupId: string, member: TestMember) {
    return http.request('GET', `/api/groups/${groupId}/weekly-brief`, {
      authorization: member.authorization,
    });
  }

  async function storeBrief(groupId: string, linkIds: string[]): Promise<void> {
    const now = new Date();
    const weekKey = isoWeekKey(now);
    await http.connection.collection('group_weekly_briefs').insertOne({
      groupId: new mongoose.Types.ObjectId(groupId),
      weekKey,
      asOf: now.toISOString().slice(0, 10),
      computedAt: now,
      version: 1,
      scanTruncated: false,
      facts: [
        {
          kind: 'open_offers',
          factId: 'open_offers',
          count: linkIds.length,
          linkIds,
        },
        {
          kind: 'skill_demand',
          factId: 'skill_demand:docker',
          skillKey: 'docker',
          skillLabel: 'Docker',
          count: linkIds.length,
          total: linkIds.length,
          linkIds,
        },
        {
          kind: 'shared_last_week',
          factId: 'shared_last_week',
          count: 1,
          linkIds: [linkIds[0]],
          weekKey: previousWeekKey(weekKey),
        },
      ],
      bullets: [
        { factId: 'skill_demand:docker', source: 'template' },
        { factId: 'shared_last_week', source: 'template' },
      ],
    });
  }

  it('200 with brief for a member', async () => {
    const group = await http.createGroup(ana, 'Con semana');
    const first = await save(JOB_PAGE, group.id);
    const second = await save(COMPUTRABAJO, group.id);
    await storeBrief(group.id, [first, second]);

    const response = await get(group.id, ana);

    expect(response.statusCode).toBe(200);
    const body = groupWeeklyBriefResponseSchema.parse(response.json());
    expect(body.weekKey).toBe(isoWeekKey(new Date()));
    expect(body.brief?.openOffers).toBe(2);
    expect(body.brief?.bullets.map((b) => b.factId)).toEqual([
      'skill_demand:docker',
      'shared_last_week',
    ]);
    expect(body.brief?.bullets[0]?.offers.map((o) => o.linkId).sort()).toEqual(
      [first, second].sort(),
    );
    expect(JSON.stringify(response.json())).not.toContain('linkIds');
  });

  it('200 with brief null', async () => {
    const group = await http.createGroup(ana, 'Sin semana');

    const response = await get(group.id, ana);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      weekKey: isoWeekKey(new Date()),
      brief: null,
    });
  });

  it('404 group_not_found for a stranger', async () => {
    const group = await http.createGroup(ana, 'Ajeno');
    const link = await save(JOB_PAGE, group.id);
    await storeBrief(group.id, [link, link]);

    const response = await get(group.id, beto);

    expect(response.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
      'group_not_found',
    );
  });

  it('404 for a malformed id', async () => {
    for (const id of ['no-es-un-id', '66e9a00000000000000000ff']) {
      const response = await get(id, ana);
      expect(response.statusCode).toBe(404);
      expect(apiErrorResponseSchema.parse(response.json()).code).toBe(
        'group_not_found',
      );
    }
  });
});
