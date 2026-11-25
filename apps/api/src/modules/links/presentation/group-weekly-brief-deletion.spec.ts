import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { GroupWeeklyBriefDeletionHook } from '../infrastructure/group-weekly-brief-deletion.hook';

// Borrado de grupo en cascada (tarea 4.5a de group-weekly-brief, H9): `LinksModule` registra su limpieza de
// `group_weekly_briefs` en `GroupDeletionHooks`, dentro de la misma transacción del borrado.

describe('deleting a group with weekly briefs', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp(
      'links-brief-del',
      getMongoTestUri(),
    );
    ana = await http.authenticated('Ana');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await http.close();
  });

  async function storeBriefs(
    groupId: string,
    weekKeys: string[],
  ): Promise<void> {
    await http.connection.collection('group_weekly_briefs').insertMany(
      weekKeys.map((weekKey) => ({
        groupId: new mongoose.Types.ObjectId(groupId),
        weekKey,
        asOf: '2026-11-25',
        computedAt: new Date(),
        version: 1,
        scanTruncated: false,
        facts: [],
        bullets: [],
      })),
    );
  }

  function briefsOf(groupId: string): Promise<number> {
    return http.connection
      .collection('group_weekly_briefs')
      .countDocuments({ groupId: new mongoose.Types.ObjectId(groupId) });
  }

  function remove(groupId: string) {
    return http.request('DELETE', `/api/groups/${groupId}`, {
      authorization: ana.authorization,
    });
  }

  it('deleting a group removes its weekly briefs', async () => {
    const doomed = await http.createGroup(ana, 'Se borra');
    await storeBriefs(doomed.id, ['2026-W47', '2026-W48']);

    const response = await remove(doomed.id);

    expect(response.statusCode).toBe(204);
    expect(await briefsOf(doomed.id)).toBe(0);
  });

  it('other groups keep their briefs', async () => {
    const doomed = await http.createGroup(ana, 'Otro que se borra');
    const kept = await http.createGroup(ana, 'Otro que se queda');
    await storeBriefs(doomed.id, ['2026-W48']);
    await storeBriefs(kept.id, ['2026-W47', '2026-W48']);

    expect((await remove(doomed.id)).statusCode).toBe(204);

    expect(await briefsOf(doomed.id)).toBe(0);
    expect(await briefsOf(kept.id)).toBe(2);
  });

  it('failing brief cleanup rolls back the whole deletion', async () => {
    const group = await http.createGroup(ana, 'No se borra');
    await storeBriefs(group.id, ['2026-W48']);
    vi.spyOn(
      GroupWeeklyBriefDeletionHook.prototype,
      'deleteRelationsOf',
    ).mockRejectedValue(new Error('brief cleanup failed'));

    const response = await remove(group.id);

    expect(response.statusCode).toBeGreaterThanOrEqual(500);
    expect(await briefsOf(group.id)).toBe(1);
    const still = await http.request('GET', `/api/groups/${group.id}`, {
      authorization: ana.authorization,
    });
    expect(still.statusCode).toBe(200);
  });
});
