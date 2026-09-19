import {
  groupTrackersResponseSchema,
  type GroupDetail,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createApplicationsTestApp,
  trackerIdsOf,
  type ApplicationsTestApp,
} from '../../../test-support/applications-test-app';
import type { TestMember } from '../../../test-support/links-test-app';
import { JOB_LINKS_COLLECTION } from '../../links/infrastructure/link.schemas';
import { APPLICATION_EVENTS_COLLECTION } from '../infrastructure/application.schemas';

// `GET /api/groups/:id/applications` y la visibilidad derivada en cada lectura, por HTTP (tareas 5.11, 5.12 y 5.13 de
// applications-tracking): salir, ser expulsada, volver, quitar el link y borrar el grupo no escriben nada en las
// postulaciones; solo cambian lo que se ve.

let urlCounter = 3_822_000_000;

function jobUrl(): string {
  urlCounter += 1;
  return `https://www.linkedin.com/jobs/view/${urlCounter}/`;
}

describe('shared application states of a group', () => {
  let http: ApplicationsTestApp;
  let owner: TestMember;
  let ana: TestMember;
  let beto: TestMember;
  let carla: TestMember;
  let stranger: TestMember;

  beforeAll(async () => {
    http = await createApplicationsTestApp(
      'applications-groups-http',
      getMongoTestUri(),
    );
    owner = await http.authenticated('Owner');
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    carla = await http.authenticated('Carla');
    stranger = await http.authenticated('Extraño');
  });

  afterAll(async () => {
    await http.close();
  });

  async function groupWith(
    name: string,
    ...members: TestMember[]
  ): Promise<GroupDetail> {
    const group = await http.createGroup(owner, name);
    for (const member of members) {
      await http.join(member, group);
    }
    return group;
  }

  async function linkIn(group: GroupDetail, by = owner): Promise<string> {
    return (await http.save(by, jobUrl(), group)).link.id;
  }

  /** Sigue el link y comparte su estado. */
  async function shareOn(
    member: TestMember,
    linkId: string,
    status: 'interested' | 'applied' | 'in_process' = 'applied',
    extra: Record<string, unknown> = {},
  ) {
    const { application } = await http.track(member, linkId, status, extra);
    return await http.share(member, application.id, 'group');
  }

  async function eventCount(applicationId: string): Promise<number> {
    return await http.connection
      .collection(APPLICATION_EVENTS_COLLECTION)
      .countDocuments({
        applicationId: new mongoose.Types.ObjectId(applicationId),
      });
  }

  describe('GET /api/groups/:id/applications', () => {
    it('Página de un grupo con procesos compartidos', async () => {
      const group = await groupWith('Página', ana, beto, carla);
      const l1 = await linkIn(group);
      const l2 = await linkIn(group);
      await shareOn(ana, l1, 'in_process');
      await shareOn(beto, l1, 'applied');
      await shareOn(beto, l2, 'applied');

      const response = await http.trackersRaw(carla, group.id, [l1, l2]);

      expect(response.statusCode).toBe(200);
      const body = groupTrackersResponseSchema.parse(response.json());
      expect(body).toEqual({
        items: [
          {
            linkId: l1,
            trackers: [
              { userId: beto.userId, displayName: 'Beto', status: 'applied' },
              { userId: ana.userId, displayName: 'Ana', status: 'in_process' },
            ],
          },
          {
            linkId: l2,
            trackers: [
              { userId: beto.userId, displayName: 'Beto', status: 'applied' },
            ],
          },
        ],
      });
    });

    it('Una nota no reordena los avatares', async () => {
      const group = await groupWith('Orden', ana, beto);
      const linkId = await linkIn(group);
      const anaApplication = await shareOn(ana, linkId);
      await shareOn(beto, linkId);
      await http.request('PATCH', `/api/applications/${anaApplication.id}`, {
        authorization: ana.authorization,
        body: { notes: 'Nota nueva' },
      });

      const body = await http.trackers(owner, group.id, [linkId]);

      expect(trackerIdsOf(body, linkId)).toEqual([beto.userId, ana.userId]);
    });

    it('Link que no está en el grupo', async () => {
      const group = await groupWith('Sin ese link', ana);
      const other = await groupWith('Con ese link', ana);
      const outside = await linkIn(other);
      const inside = await linkIn(group);
      await shareOn(ana, outside);

      const body = await http.trackers(owner, group.id, [
        outside,
        inside,
        'no-es-un-id',
      ]);

      expect(body.items.map((item) => item.linkId)).toEqual([inside]);
    });

    it('Extraño', async () => {
      const group = await groupWith('Cerrado', ana);
      const linkId = await linkIn(group);

      for (const [member, groupId] of [
        [stranger, group.id],
        [ana, 'no-es-un-id'],
        [ana, new mongoose.Types.ObjectId().toHexString()],
      ] as const) {
        const response = await http.trackersRaw(member, groupId, [linkId]);
        expect(response.statusCode).toBe(404);
        expect(response.json()).toEqual({
          code: 'group_not_found',
          message: 'Group not found',
        });
      }
    });

    it('Seguir no avisa al grupo', async () => {
      const group = await groupWith('Privado por defecto', ana, beto);
      const linkId = await linkIn(group);
      await http.track(ana, linkId, 'applied');

      const body = await http.trackers(beto, group.id, [linkId]);

      expect(body.items).toEqual([{ linkId, trackers: [] }]);
    });

    it('La etapa sigue siendo privada', async () => {
      const group = await groupWith('Etapa privada', ana, beto);
      const linkId = await linkIn(group);
      const application = await shareOn(ana, linkId, 'in_process', {
        stageLabel: 'Entrevista con el CTO',
      });
      await http.request('PATCH', `/api/applications/${application.id}`, {
        authorization: ana.authorization,
        body: { notes: 'Piden inglés C1' },
      });

      const response = await http.trackersRaw(beto, group.id, [linkId]);

      expect(groupTrackersResponseSchema.parse(response.json()).items).toEqual([
        {
          linkId,
          trackers: [
            { userId: ana.userId, displayName: 'Ana', status: 'in_process' },
          ],
        },
      ]);
      expect(response.body).not.toContain('Entrevista');
      expect(response.body).not.toContain('inglés');
      expect(response.body).not.toContain(application.id);
    });

    it('Demasiados links, o ninguno', async () => {
      const group = await groupWith('Límite', ana);
      const ids = Array.from({ length: 51 }, () =>
        new mongoose.Types.ObjectId().toHexString(),
      );

      for (const linkIds of [ids, []]) {
        const response = await http.trackersRaw(ana, group.id, linkIds);
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({
          code: 'validation_error',
          fields: ['linkIds'],
        });
      }
    });
  });

  describe('visibility derived from the membership', () => {
    it('Sale del grupo', async () => {
      const group = await groupWith('Salida', ana, beto);
      const linkId = await linkIn(group);
      const application = await shareOn(ana, linkId);

      const left = await http.request(
        'DELETE',
        `/api/groups/${group.id}/members/me`,
        { authorization: ana.authorization },
      );
      expect(left.statusCode).toBe(204);

      expect(
        trackerIdsOf(await http.trackers(beto, group.id, [linkId]), linkId),
      ).toEqual([]);
      const [stored] = await http.mine(ana, [linkId]);
      expect(stored).toEqual(application);
      expect(await eventCount(application.id)).toBe(1);
    });

    it('Expulsada', async () => {
      const group = await groupWith('Expulsión', ana, beto);
      const linkId = await linkIn(group);
      const application = await shareOn(ana, linkId);

      const removed = await http.request(
        'DELETE',
        `/api/groups/${group.id}/members/${ana.userId}`,
        { authorization: owner.authorization },
      );
      expect(removed.statusCode).toBe(204);

      expect(
        trackerIdsOf(await http.trackers(beto, group.id, [linkId]), linkId),
      ).toEqual([]);
      expect(await http.mine(ana, [linkId])).toEqual([application]);
    });

    it('Vuelve a entrar', async () => {
      const group = await groupWith('Vuelta', ana, beto);
      const linkId = await linkIn(group);
      await shareOn(ana, linkId);
      await http.request('DELETE', `/api/groups/${group.id}/members/me`, {
        authorization: ana.authorization,
      });

      await http.join(ana, group);

      expect(
        trackerIdsOf(await http.trackers(beto, group.id, [linkId]), linkId),
      ).toEqual([ana.userId]);
    });

    it('Compartir con los grupos donde está la oferta', async () => {
      const g1 = await groupWith('G1', ana, beto);
      const g2 = await groupWith('G2', ana, carla);
      const g3 = await groupWith('G3', ana, beto);
      const linkId = await linkIn(g1);
      const shared = await http.request('POST', '/api/links', {
        authorization: owner.authorization,
        body: { url: await displayUrlOf(linkId), groupId: g2.id },
      });
      expect(shared.statusCode).toBe(201);
      const g3Link = await linkIn(g3);

      await shareOn(ana, linkId);

      expect(
        trackerIdsOf(await http.trackers(beto, g1.id, [linkId]), linkId),
      ).toEqual([ana.userId]);
      expect(
        trackerIdsOf(await http.trackers(carla, g2.id, [linkId]), linkId),
      ).toEqual([ana.userId]);
      const inG3 = await http.trackers(beto, g3.id, [linkId, g3Link]);
      expect(inG3.items.map((item) => item.linkId)).toEqual([g3Link]);
      expect(trackerIdsOf(inG3, g3Link)).toEqual([]);
    });

    it('La oferta llega después a otro grupo', async () => {
      const g1 = await groupWith('Antes', ana);
      const g2 = await groupWith('Después', ana, beto);
      const linkId = await linkIn(g1);
      await shareOn(ana, linkId);

      const shared = await http.request('POST', '/api/links', {
        authorization: owner.authorization,
        body: { url: await displayUrlOf(linkId), groupId: g2.id },
      });
      expect(shared.statusCode).toBe(201);

      expect(
        trackerIdsOf(await http.trackers(beto, g2.id, [linkId]), linkId),
      ).toEqual([ana.userId]);
    });

    it('Deja de verse en el grupo', async () => {
      const group = await groupWith('Dejar de seguir', ana, beto);
      const linkId = await linkIn(group);
      const application = await shareOn(ana, linkId);

      const response = await http.request(
        'DELETE',
        `/api/applications/${application.id}`,
        { authorization: ana.authorization },
      );
      expect(response.statusCode).toBe(204);

      expect(
        trackerIdsOf(await http.trackers(beto, group.id, [linkId]), linkId),
      ).toEqual([]);
    });
  });

  describe('visibility derived from the links, and deletion', () => {
    it('Quitan la oferta del grupo', async () => {
      const group = await groupWith('Quitar', ana, beto);
      const linkId = await linkIn(group, beto);
      const application = await shareOn(ana, linkId);

      const removed = await http.request(
        'DELETE',
        `/api/groups/${group.id}/links/${linkId}`,
        { authorization: beto.authorization },
      );
      expect(removed.statusCode).toBe(204);

      const without = await http.trackers(owner, group.id, [linkId]);
      expect(without.items).toEqual([]);
      expect(await http.mine(ana, [linkId])).toEqual([application]);

      const again = await http.request('POST', '/api/links', {
        authorization: beto.authorization,
        body: { url: await displayUrlOf(linkId), groupId: group.id },
      });
      expect(again.statusCode).toBe(201);
      expect(
        trackerIdsOf(await http.trackers(owner, group.id, [linkId]), linkId),
      ).toEqual([ana.userId]);
    });

    it('Borran el grupo / El borrado no destruye las postulaciones', async () => {
      const group = await groupWith('Borrado', ana, beto);
      const linkId = await linkIn(group);
      const anaApplication = await shareOn(ana, linkId, 'in_process', {
        stageLabel: 'Entrevista',
      });
      const { application: betoApplication } = await http.track(
        beto,
        linkId,
        'applied',
      );

      const deleted = await http.request('DELETE', `/api/groups/${group.id}`, {
        authorization: owner.authorization,
      });
      expect(deleted.statusCode).toBe(204);

      expect(await http.mine(ana, [linkId])).toEqual([anaApplication]);
      expect(await http.mine(beto, [linkId])).toEqual([betoApplication]);
      expect(anaApplication.link.id).toBe(linkId);
      expect(await eventCount(anaApplication.id)).toBe(1);
      expect(await eventCount(betoApplication.id)).toBe(1);
      const gone = await http.trackersRaw(ana, group.id, [linkId]);
      expect(gone.statusCode).toBe(404);
    });
  });

  /** URL con la que se guardó el link, para volver a compartirlo en otro grupo. */
  async function displayUrlOf(linkId: string): Promise<string> {
    const document = await http.connection
      .collection<{ displayUrl: string }>(JOB_LINKS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
    if (document === null) {
      throw new Error('The link does not exist');
    }
    return document.displayUrl;
  }
});
