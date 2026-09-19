import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, {
  type ClientSession,
  type Connection,
  type Types,
} from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { NewApplicationEvent } from '../domain/application-event';
import {
  changeStatus,
  startTracking,
  type Application,
} from '../domain/application.entity';
import type { ApplicationStatus } from '../domain/application-status';
import {
  APPLICATION_EVENT_MODEL_NAME,
  APPLICATION_EVENTS_COLLECTION,
  APPLICATION_MODEL_NAME,
  APPLICATIONS_COLLECTION,
} from './application.schemas';
import { MongoApplicationRepository } from './mongo-application.repository';

// Adaptador Mongo de APPLICATION_REPOSITORY (tareas 4.2 a 4.5 de applications-tracking) contra el MongoMemoryReplSet del
// preset de @linkvault/testing: el alta, el cambio de estado y el borrado van en transacciones.

let connection: Connection;
let repository: MongoApplicationRepository;

const oid = (): string => new mongoose.Types.ObjectId().toHexString();
const ANA = oid();
const BETO = oid();
const T0 = new Date('2026-09-19T10:00:00.000Z');
const T1 = new Date('2026-09-19T11:00:00.000Z');
const T2 = new Date('2026-09-19T12:00:00.000Z');

/** Repositorio cuya relectura tras el choque del alta ve antes cómo otra pestaña deja de seguir la postulación. */
class UntrackBeforeReread extends MongoApplicationRepository {
  rereads = 0;

  protected override async findExisting(
    userId: Types.ObjectId,
    linkId: Types.ObjectId,
  ): Promise<Application | null> {
    this.rereads += 1;
    if (this.rereads === 1) {
      const existing = await super.findExisting(userId, linkId);
      if (existing !== null) {
        await this.delete(existing.id, existing.userId);
      }
    }
    return await super.findExisting(userId, linkId);
  }
}

/** Repositorio cuya escritura del evento falla siempre. */
class FailingEvents extends MongoApplicationRepository {
  protected override insertEvent(
    _applicationId: Types.ObjectId,
    _userId: Types.ObjectId,
    _event: NewApplicationEvent,
    _session: ClientSession,
  ): Promise<void> {
    return Promise.reject(new Error('event insert failed'));
  }
}

function track(
  userId: string,
  linkId: string,
  status: ApplicationStatus = 'interested',
  now = T0,
) {
  return repository.create(startTracking({ userId, linkId, status, now }));
}

async function move(
  application: Application,
  status: ApplicationStatus,
  now: Date,
  target = repository,
): Promise<boolean> {
  const change = changeStatus(application, { status }, now);
  if (change.kind !== 'changed') {
    throw new Error('expected a change');
  }
  return await target.changeStatus(
    application.id,
    application.userId,
    change.write,
    change.event,
  );
}

function eventCount(): Promise<number> {
  return connection.collection(APPLICATION_EVENTS_COLLECTION).countDocuments();
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), {
      dbName: `applications-${randomUUID()}`,
    })
    .asPromise();
  repository = new MongoApplicationRepository(connection);
  await connection.model(APPLICATION_MODEL_NAME).init();
  await connection.model(APPLICATION_EVENT_MODEL_NAME).init();
});

afterEach(async () => {
  await connection.collection(APPLICATIONS_COLLECTION).deleteMany({});
  await connection.collection(APPLICATION_EVENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

describe('create', () => {
  it('stores the application and its first event', async () => {
    const link = oid();
    const { application, created } = await track(ANA, link, 'applied');

    expect(created).toBe(true);
    expect(application).toMatchObject({
      userId: ANA,
      linkId: link,
      status: 'applied',
      visibility: 'private',
      notes: '',
      appliedAt: T0,
      statusChangedAt: T0,
      version: 1,
    });
    expect(await repository.eventsOf(application.id, ANA)).toEqual([
      {
        id: expect.any(String),
        applicationId: application.id,
        userId: ANA,
        to: 'applied',
        at: T0,
      },
    ]);
  });

  it('Ya la seguía: answers the existing one intact, without a new event', async () => {
    const link = oid();
    const first = await track(ANA, link, 'interested');
    const again = await track(ANA, link, 'applied', T1);

    expect(again).toEqual({ application: first.application, created: false });
    expect(await eventCount()).toBe(1);
  });

  it('Dos pestañas pulsan a la vez', async () => {
    const link = oid();
    const results = await Promise.all([
      track(ANA, link, 'interested'),
      track(ANA, link, 'applied'),
    ]);

    expect(results.map((result) => result.created).sort()).toEqual([
      false,
      true,
    ]);
    const winner = results.find((result) => result.created);
    const loser = results.find((result) => !result.created);
    expect(loser?.application.status).toBe(winner?.application.status);
    expect(
      await connection
        .collection(APPLICATIONS_COLLECTION)
        .countDocuments({ linkId: new mongoose.Types.ObjectId(link) }),
    ).toBe(1);
    expect(await eventCount()).toBe(1);
  });

  it('Seguir mientras otra pestaña deja de seguir', async () => {
    const racing = new UntrackBeforeReread(connection);
    const link = oid();
    await track(ANA, link, 'interested');

    const result = await racing.create(
      startTracking({ userId: ANA, linkId: link, status: 'applied', now: T1 }),
    );

    expect(result.created).toBe(true);
    expect(result.application).toMatchObject({ status: 'applied', version: 1 });
    expect(racing.rereads).toBe(1);
    expect(await repository.listByUser(ANA)).toHaveLength(1);
    expect(await eventCount()).toBe(1);
  });

  it('lets many people follow the same link', async () => {
    const link = oid();
    await track(ANA, link);
    await track(BETO, link);

    expect(
      await connection
        .collection(APPLICATIONS_COLLECTION)
        .countDocuments({ linkId: new mongoose.Types.ObjectId(link) }),
    ).toBe(2);
  });
});

describe('changeStatus', () => {
  it('writes the change and its event, raising the version', async () => {
    const { application } = await track(ANA, oid());

    expect(await move(application, 'applied', T1)).toBe(true);

    const stored = await repository.findOwned(application.id, ANA);
    expect(stored).toMatchObject({
      status: 'applied',
      version: 2,
      appliedAt: T1,
      statusChangedAt: T1,
    });
    expect(
      (await repository.eventsOf(application.id, ANA)).map((event) => [
        event.from,
        event.to,
      ]),
    ).toEqual([
      [undefined, 'interested'],
      ['interested', 'applied'],
    ]);
  });

  it('removes the stage and the date when the change leaves them out', async () => {
    const { application } = await repository.create(
      startTracking({
        userId: ANA,
        linkId: oid(),
        status: 'in_process',
        stageLabel: 'Entrevista',
        now: T0,
      }),
    );

    expect(await move(application, 'interested', T1)).toBe(true);

    const stored = await repository.findOwned(application.id, ANA);
    expect(stored).not.toHaveProperty('stageLabel');
    expect(stored).not.toHaveProperty('appliedAt');
    const raw = await connection
      .collection(APPLICATIONS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(application.id) });
    expect(raw).not.toHaveProperty('stageLabel');
    expect(raw).not.toHaveProperty('appliedAt');
  });

  it('Cambio desde una pestaña vieja', async () => {
    const { application } = await track(ANA, oid());

    expect(await move(application, 'applied', T1)).toBe(true);
    expect(await move(application, 'rejected', T2)).toBe(false);

    expect(await repository.findOwned(application.id, ANA)).toMatchObject({
      status: 'applied',
      version: 2,
    });
    expect(await eventCount()).toBe(2);
  });

  it('Editar notas no invalida un cambio de estado', async () => {
    const { application } = await track(ANA, oid());
    await repository.update(application.id, ANA, {
      notes: 'Piden inglés C1',
      updatedAt: T1,
    });

    expect(await move(application, 'applied', T2)).toBe(true);
  });

  it('Cambio y evento, juntos o ninguno', async () => {
    const failing = new FailingEvents(connection);
    const { application } = await track(ANA, oid());

    await expect(move(application, 'applied', T1, failing)).rejects.toThrow(
      'event insert failed',
    );

    expect(await repository.findOwned(application.id, ANA)).toMatchObject({
      status: 'interested',
      version: 1,
      statusChangedAt: T0,
    });
    expect(await eventCount()).toBe(1);
  });

  it('writes nothing on the application of somebody else', async () => {
    const { application } = await track(ANA, oid());
    const change = changeStatus(application, { status: 'applied' }, T1);
    if (change.kind !== 'changed') throw new Error('expected a change');

    expect(
      await repository.changeStatus(
        application.id,
        BETO,
        change.write,
        change.event,
      ),
    ).toBe(false);
    expect(
      await repository.changeStatus(
        'no-es-un-id',
        ANA,
        change.write,
        change.event,
      ),
    ).toBe(false);
    expect(await eventCount()).toBe(1);
  });
});

describe('update', () => {
  it('edits notes and visibility without the version nor statusChangedAt', async () => {
    const { application } = await track(ANA, oid());

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
    expect(await eventCount()).toBe(1);
    expect(
      await repository.update(application.id, BETO, {
        notes: 'x',
        updatedAt: T1,
      }),
    ).toBeNull();
  });
});

describe('delete', () => {
  it('deletes the application with its events, and leaves the others intact', async () => {
    const link = oid();
    const ana = await track(ANA, link);
    const beto = await track(BETO, link);
    await move(ana.application, 'applied', T1);

    expect(await repository.delete(ana.application.id, ANA)).toBe(true);

    expect(await repository.findOwned(ana.application.id, ANA)).toBeNull();
    expect(await repository.eventsOf(ana.application.id, ANA)).toEqual([]);
    expect(
      await repository.findOwned(beto.application.id, BETO),
    ).not.toBeNull();
    expect(await eventCount()).toBe(1);
  });

  it('touches nothing when the application is somebody else’s', async () => {
    const ana = await track(ANA, oid());

    expect(await repository.delete(ana.application.id, BETO)).toBe(false);
    expect(await repository.delete('no-es-un-id', ANA)).toBe(false);
    expect(await eventCount()).toBe(1);
  });

  it('a later status change finds nothing and writes no event', async () => {
    const ana = await track(ANA, oid());
    await repository.delete(ana.application.id, ANA);

    expect(await move(ana.application, 'applied', T1)).toBe(false);
    expect(await eventCount()).toBe(0);
  });
});

describe('reads', () => {
  it('lists the applications of a person, most recently changed first', async () => {
    const first = await track(ANA, oid(), 'interested', T0);
    const second = await track(ANA, oid(), 'interested', T1);
    await track(BETO, oid());
    await repository.update(first.application.id, ANA, {
      notes: 'x',
      updatedAt: T2,
    });

    expect(
      (await repository.listByUser(ANA)).map((application) => application.id),
    ).toEqual([first.application.id, second.application.id]);
    expect(
      (
        await repository.listByUser(ANA, [
          second.application.linkId,
          'no-es-un-id',
        ])
      ).map((application) => application.id),
    ).toEqual([second.application.id]);
    expect(await repository.listByUser(ANA, ['no-es-un-id'])).toEqual([]);
    expect(await repository.listByUser('no-es-un-id')).toEqual([]);
  });

  it('answers the events of an application in order, only to its owner', async () => {
    const { application } = await track(ANA, oid());
    await move(application, 'applied', T1);

    expect(
      (await repository.eventsOf(application.id, ANA)).map((event) => event.to),
    ).toEqual(['interested', 'applied']);
    expect(await repository.eventsOf(application.id, BETO)).toEqual([]);
  });

  it('answers only what the group sees of the shared applications of its members', async () => {
    const link = oid();
    const other = oid();
    const ana = await track(ANA, link, 'in_process');
    const beto = await track(BETO, link);
    await track(ANA, other);
    await repository.update(ana.application.id, ANA, {
      visibility: 'group',
      updatedAt: T1,
    });
    await repository.update(beto.application.id, BETO, {
      visibility: 'group',
      updatedAt: T1,
    });

    expect(
      await repository.sharedOn([link, other, 'no-es-un-id'], [ANA]),
    ).toEqual([
      { linkId: link, userId: ANA, status: 'in_process', statusChangedAt: T0 },
    ]);
    expect(await repository.sharedOn([link], [])).toEqual([]);
  });

  it('uses the planned indexes', async () => {
    const link = new mongoose.Types.ObjectId();
    const user = new mongoose.Types.ObjectId();
    const collection = connection.collection(APPLICATIONS_COLLECTION);

    const shared = JSON.stringify(
      await collection
        .find(
          {
            linkId: { $in: [link] },
            visibility: 'group',
            userId: { $in: [user] },
          },
          {
            projection: {
              _id: 0,
              linkId: 1,
              userId: 1,
              status: 1,
              statusChangedAt: 1,
            },
          },
        )
        .explain('queryPlanner'),
    );
    const board = JSON.stringify(
      await collection
        .find({ userId: user })
        .sort({ updatedAt: -1, _id: -1 })
        .explain('queryPlanner'),
    );
    const timeline = JSON.stringify(
      await connection
        .collection(APPLICATION_EVENTS_COLLECTION)
        .find({ applicationId: link, userId: user })
        .sort({ at: 1, _id: 1 })
        .explain('queryPlanner'),
    );

    expect(shared).toContain('"linkId":1,"visibility":1,"userId":1');
    expect(board).toContain('"userId":1,"updatedAt":-1,"_id":-1');
    expect(timeline).toContain('"applicationId":1,"at":1,"_id":1');
    for (const plan of [shared, board, timeline]) {
      expect(plan).not.toContain('COLLSCAN');
    }
  });
});
