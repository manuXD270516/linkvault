import { trackLinkResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { InvalidAppliedAt, TrackedLinkNotFound } from '../domain/errors';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const LINK = objectId(1);
const FOREIGN_LINK = objectId(2);
const DAY = 24 * 60 * 60 * 1000;

let h: ApplicationsHarness;

beforeEach(() => {
  h = applicationsHarness();
  h.links
    .withLink(LINK, { title: 'Backend', company: 'Acme' })
    .readableBy(ANA, LINK)
    .withLink(FOREIGN_LINK);
});

describe('TrackLink', () => {
  it('«Postulé» desde la tarjeta', async () => {
    const response = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'applied',
    });

    expect(trackLinkResponseSchema.parse(response)).toEqual(response);
    expect(response.created).toBe(true);
    expect(response.application).toMatchObject({
      linkId: LINK,
      status: 'applied',
      visibility: 'private',
      version: 1,
      appliedAt: h.clock.now().toISOString(),
      link: { id: LINK, title: 'Backend', company: 'Acme' },
    });
    const events = await h.timeline.execute(ANA, response.application.id);
    expect(events.items).toEqual([
      {
        id: expect.any(String),
        to: 'applied',
        at: h.clock.now().toISOString(),
      },
    ]);
  });

  it('«Me interesa» desde la lista privada', async () => {
    const response = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'interested',
    });

    expect(response.application.status).toBe('interested');
    expect(response.application).not.toHaveProperty('appliedAt');
  });

  it('Postulé hace unos días', async () => {
    const fourDaysAgo = new Date(h.clock.now().getTime() - 4 * DAY);

    const response = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'applied',
      appliedAt: fourDaysAgo.toISOString(),
    });

    expect(response.application.appliedAt).toBe(fourDaysAgo.toISOString());
  });

  it('rejects a future date with the clock of the server', async () => {
    await expect(
      h.trackLink.execute(ANA, {
        linkId: LINK,
        status: 'applied',
        appliedAt: new Date(h.clock.now().getTime() + 2 * DAY).toISOString(),
      }),
    ).rejects.toBeInstanceOf(InvalidAppliedAt);
    expect(h.repository.all).toEqual([]);
  });

  it('Oferta que no se puede ver', async () => {
    for (const linkId of [FOREIGN_LINK, objectId(99), 'no-es-un-id']) {
      await expect(
        h.trackLink.execute(ANA, { linkId, status: 'interested' }),
      ).rejects.toBeInstanceOf(TrackedLinkNotFound);
    }
    expect(h.repository.all).toEqual([]);
  });

  it('Ya la seguía', async () => {
    const first = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'in_process',
    });

    const again = await h.trackLink.execute(ANA, {
      linkId: LINK,
      status: 'interested',
    });

    expect(again.created).toBe(false);
    expect(again.application).toEqual(first.application);
    expect(h.repository.allEvents).toHaveLength(1);
  });
});
