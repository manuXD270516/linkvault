import { groupTrackersResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { TrackersGroupNotFound } from '../domain/errors';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const CARLA = objectId(0xc3);
const STRANGER = objectId(0xd4);
const GROUP = objectId(0x100);
const L1 = objectId(0xf001);
const L2 = objectId(0xf002);
const OUTSIDE = objectId(0xf003);
const HOUR = 60 * 60 * 1000;

let h: ApplicationsHarness;

beforeEach(() => {
  h = applicationsHarness();
  for (const [userId, name] of [
    [ANA, 'Ana'],
    [BETO, 'Beto'],
    [CARLA, 'Carla'],
  ] as const) {
    h.groups.withMember(GROUP, userId);
    h.directory.withUser(userId, name);
  }
  h.directory.withUser(STRANGER, 'Extraño');
  for (const linkId of [L1, L2, OUTSIDE]) {
    h.links.withLink(linkId);
    for (const userId of [ANA, BETO, CARLA]) {
      h.links.readableBy(userId, linkId);
    }
  }
  h.links.sharedIn(GROUP, L1).sharedIn(GROUP, L2);
});

async function share(
  userId: string,
  linkId: string,
  status: 'interested' | 'applied' | 'in_process',
  stageLabel?: string,
) {
  h.clock.advance(HOUR);
  const { application } = await h.trackLink.execute(userId, {
    linkId,
    status,
    ...(stageLabel === undefined ? {} : { stageLabel }),
  });
  await h.update.execute(userId, application.id, { visibility: 'group' });
  return application;
}

function trackersOf(userId: string, linkIds: string[]) {
  return h.trackers.execute(userId, GROUP, linkIds);
}

describe('ListGroupTrackers', () => {
  it('Página de un grupo con procesos compartidos', async () => {
    await share(ANA, L1, 'in_process');
    await share(BETO, L1, 'applied');
    await share(BETO, L2, 'applied');

    const response = await trackersOf(CARLA, [L1, L2]);

    expect(groupTrackersResponseSchema.parse(response)).toEqual(response);
    expect(response).toEqual({
      items: [
        {
          linkId: L1,
          trackers: [
            { userId: BETO, displayName: 'Beto', status: 'applied' },
            { userId: ANA, displayName: 'Ana', status: 'in_process' },
          ],
        },
        {
          linkId: L2,
          trackers: [{ userId: BETO, displayName: 'Beto', status: 'applied' }],
        },
      ],
    });
  });

  it('includes whoever asks when they share theirs, and links nobody shares', async () => {
    await share(CARLA, L1, 'applied');

    const response = await trackersOf(CARLA, [L1, L2]);

    expect(response.items).toEqual([
      {
        linkId: L1,
        trackers: [{ userId: CARLA, displayName: 'Carla', status: 'applied' }],
      },
      { linkId: L2, trackers: [] },
    ]);
  });

  it('Una nota no reordena los avatares', async () => {
    const ana = await share(ANA, L1, 'applied');
    await share(BETO, L1, 'applied');
    h.clock.advance(HOUR);
    await h.update.execute(ANA, ana.id, { notes: 'nota nueva' });

    const response = await trackersOf(CARLA, [L1]);

    expect(
      response.items[0]?.trackers.map((tracker) => tracker.userId),
    ).toEqual([BETO, ANA]);
  });

  it('Link que no está en el grupo', async () => {
    await share(ANA, OUTSIDE, 'applied');

    const response = await trackersOf(BETO, [OUTSIDE, L1, 'no-es-un-id']);

    expect(response.items.map((item) => item.linkId)).toEqual([L1]);
  });

  it('Extraño', async () => {
    await expect(
      h.trackers.execute(STRANGER, GROUP, [L1]),
    ).rejects.toBeInstanceOf(TrackersGroupNotFound);
    await expect(
      h.trackers.execute(ANA, 'no-es-un-id', [L1]),
    ).rejects.toBeInstanceOf(TrackersGroupNotFound);
    expect(h.links.linkIdsSharedInCalls).toBe(0);
  });

  it('Seguir no avisa al grupo', async () => {
    h.clock.advance(HOUR);
    await h.trackLink.execute(ANA, { linkId: L1, status: 'applied' });

    const response = await trackersOf(BETO, [L1]);

    expect(response.items).toEqual([{ linkId: L1, trackers: [] }]);
  });

  it('La etapa sigue siendo privada', async () => {
    const ana = await share(ANA, L1, 'in_process', 'Entrevista con el CTO');
    await h.update.execute(ANA, ana.id, { notes: 'Piden inglés C1' });

    const response = await trackersOf(BETO, [L1]);

    expect(response.items[0]?.trackers).toEqual([
      { userId: ANA, displayName: 'Ana', status: 'in_process' },
    ]);
    const body = JSON.stringify(response);
    expect(body).not.toContain('Entrevista');
    expect(body).not.toContain('inglés');
    expect(body).not.toContain(ana.id);
  });

  it('Sale del grupo, and comes back', async () => {
    await share(ANA, L1, 'applied');
    h.groups.withoutMember(GROUP, ANA);

    expect((await trackersOf(BETO, [L1])).items[0]?.trackers).toEqual([]);

    h.groups.withMember(GROUP, ANA);
    expect(
      (await trackersOf(BETO, [L1])).items[0]?.trackers.map((t) => t.userId),
    ).toEqual([ANA]);
  });

  it.each([2, 50])(
    'Consultas fijas: one read of each port with %i links',
    async (count) => {
      const linkIds = Array.from({ length: count }, (_, index) =>
        objectId(0x1000 + index),
      );
      for (const linkId of linkIds) {
        h.links
          .withLink(linkId)
          .sharedIn(GROUP, linkId)
          .readableBy(ANA, linkId);
        h.links.readableBy(BETO, linkId);
        await share(ANA, linkId, 'applied');
        await share(BETO, linkId, 'interested');
      }
      h.groups.memberIdsOfCalls = 0;
      h.links.linkIdsSharedInCalls = 0;
      h.repository.sharedOnCalls = 0;
      h.directory.displayNamesOfCalls = 0;

      const response = await trackersOf(CARLA, linkIds);

      expect(response.items).toHaveLength(count);
      expect(response.items.every((item) => item.trackers.length === 2)).toBe(
        true,
      );
      expect({
        members: h.groups.memberIdsOfCalls,
        links: h.links.linkIdsSharedInCalls,
        applications: h.repository.sharedOnCalls,
        names: h.directory.displayNamesOfCalls,
      }).toEqual({ members: 1, links: 1, applications: 1, names: 1 });
    },
  );
});
