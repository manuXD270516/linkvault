import { beforeEach, describe, expect, it } from 'vitest';
import { changeStatus, startTracking } from '../../domain/application.entity';
import { InMemoryApplicationRepository } from './in-memory-application.repository';

const ANA = 'a0000000000000000000000a';
const BETO = 'b0000000000000000000000b';
const LINK = 'c0000000000000000000000c';
const OTHER_LINK = 'd0000000000000000000000d';
const T0 = new Date('2026-09-19T10:00:00.000Z');
const T1 = new Date('2026-09-19T11:00:00.000Z');

let repository: InMemoryApplicationRepository;

beforeEach(() => {
  repository = new InMemoryApplicationRepository();
});

function track(userId = ANA, linkId = LINK, now = T0) {
  return repository.create(
    startTracking({ userId, linkId, status: 'interested', now }),
  );
}

describe('InMemoryApplicationRepository', () => {
  it('creates one application per person and link, with its first event', async () => {
    const first = await track();
    const second = await repository.create(
      startTracking({ userId: ANA, linkId: LINK, status: 'applied', now: T1 }),
    );

    expect(first.created).toBe(true);
    expect(second).toEqual({ application: first.application, created: false });
    expect(repository.all).toHaveLength(1);
    expect(repository.allEvents).toHaveLength(1);
  });

  it('writes a status change only with the current version, and its event only then', async () => {
    const { application } = await track();
    const change = changeStatus(application, { status: 'applied' }, T1);
    if (change.kind !== 'changed') throw new Error('expected a change');

    expect(
      await repository.changeStatus(
        application.id,
        ANA,
        change.write,
        change.event,
      ),
    ).toBe(true);
    expect(
      await repository.changeStatus(
        application.id,
        ANA,
        change.write,
        change.event,
      ),
    ).toBe(false);
    expect((await repository.findOwned(application.id, ANA))?.version).toBe(2);
    expect(await repository.eventsOf(application.id, ANA)).toHaveLength(2);
  });

  it('treats the application of somebody else as missing', async () => {
    const { application } = await track();

    expect(await repository.findOwned(application.id, BETO)).toBeNull();
    expect(
      await repository.update(application.id, BETO, {
        notes: 'x',
        updatedAt: T1,
      }),
    ).toBeNull();
    expect(await repository.delete(application.id, BETO)).toBe(false);
    expect(await repository.eventsOf(application.id, BETO)).toEqual([]);
    expect(await repository.findOwned('no-es-un-id', ANA)).toBeNull();
  });

  it('edits notes and visibility without touching the version', async () => {
    const { application } = await track();

    const updated = await repository.update(application.id, ANA, {
      notes: 'nota',
      visibility: 'group',
      updatedAt: T1,
    });

    expect(updated).toMatchObject({
      notes: 'nota',
      visibility: 'group',
      version: 1,
      statusChangedAt: T0,
      updatedAt: T1,
    });
  });

  it('deletes an application with its events, and nothing else', async () => {
    const { application } = await track();
    await track(BETO);

    expect(await repository.delete(application.id, ANA)).toBe(true);
    expect(repository.all.map((item) => item.userId)).toEqual([BETO]);
    expect(repository.allEvents).toHaveLength(1);
  });

  it('lists the applications of a person by updatedAt, optionally by link', async () => {
    await track(ANA, LINK, T0);
    await track(ANA, OTHER_LINK, T1);
    await track(BETO, LINK, T1);

    const all = await repository.listByUser(ANA);
    expect(all.map((item) => item.linkId)).toEqual([OTHER_LINK, LINK]);
    expect(
      (await repository.listByUser(ANA, [LINK, 'no-es-un-id'])).map(
        (item) => item.linkId,
      ),
    ).toEqual([LINK]);
  });

  it('answers only the shared applications of the given members and links', async () => {
    const ana = await track(ANA);
    await track(BETO);
    await repository.update(ana.application.id, ANA, {
      visibility: 'group',
      updatedAt: T1,
    });

    expect(await repository.sharedOn([LINK], [ANA, BETO])).toEqual([
      { linkId: LINK, userId: ANA, status: 'interested', statusChangedAt: T0 },
    ]);
    expect(await repository.sharedOn([LINK], [BETO])).toEqual([]);
    expect(repository.sharedOnCalls).toBe(2);
  });
});
