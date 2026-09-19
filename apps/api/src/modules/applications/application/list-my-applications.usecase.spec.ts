import { applicationListResponseSchema } from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applicationsHarness,
  objectId,
  type ApplicationsHarness,
} from './testing/applications-test-harness';

const ANA = objectId(0xa1);
const BETO = objectId(0xb2);
const FIRST = objectId(1);
const SECOND = objectId(2);
const THIRD = objectId(3);
const HOUR = 60 * 60 * 1000;

let h: ApplicationsHarness;

beforeEach(() => {
  h = applicationsHarness();
  h.links
    .withLink(FIRST, { title: 'Backend', previewStatus: 'enriched' })
    .withLink(SECOND, { title: 'Frontend', previewStatus: 'enriched' })
    .withLink(THIRD)
    .readableBy(ANA, FIRST)
    .readableBy(ANA, SECOND)
    .readableBy(ANA, THIRD)
    .readableBy(BETO, THIRD);
});

async function track(userId: string, linkId: string) {
  h.clock.advance(HOUR);
  return (await h.trackLink.execute(userId, { linkId, status: 'interested' }))
    .application;
}

describe('ListMyApplications', () => {
  it('Tablero con lo que sigo', async () => {
    await track(ANA, FIRST);
    await track(ANA, SECOND);
    await track(BETO, THIRD);
    h.links.cardsOfCalls = 0;

    const response = await h.listMine.execute(ANA);

    expect(applicationListResponseSchema.parse(response)).toEqual(response);
    expect(response.items.map((item) => item.link.title)).toEqual([
      'Frontend',
      'Backend',
    ]);
    expect(h.links.cardsOfCalls).toBe(1);
  });

  it('orders by the last change of any kind, a note included', async () => {
    const first = await track(ANA, FIRST);
    await track(ANA, SECOND);
    h.clock.advance(HOUR);
    await h.update.execute(ANA, first.id, { notes: 'x' });

    const response = await h.listMine.execute(ANA);

    expect(response.items.map((item) => item.linkId)).toEqual([FIRST, SECOND]);
  });

  it('Estado propio de una página de tarjetas', async () => {
    await track(ANA, SECOND);

    const response = await h.listMine.execute(ANA, [FIRST, SECOND, THIRD]);

    expect(response.items.map((item) => item.linkId)).toEqual([SECOND]);
  });

  it('Se fue del grupo, conserva su proceso', async () => {
    const application = await track(ANA, THIRD);
    h.links.unreadableBy(ANA, THIRD);

    const response = await h.listMine.execute(ANA);

    expect(response.items).toEqual([
      expect.objectContaining({
        id: application.id,
        status: 'interested',
        link: expect.objectContaining({ id: THIRD }),
      }),
    ]);
    expect((await h.timeline.execute(ANA, application.id)).items).toHaveLength(
      1,
    );
  });

  it('Guardar no es seguir: an empty board does not ask for cards', async () => {
    const response = await h.listMine.execute(ANA);

    expect(response).toEqual({ items: [] });
    expect(h.links.cardsOfCalls).toBe(0);
  });
});
