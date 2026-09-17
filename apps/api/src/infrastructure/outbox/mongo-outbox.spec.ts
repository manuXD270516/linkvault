import { randomUUID } from 'node:crypto';
import { getMongoTestUri } from '@linkvault/testing';
import {
  LINK_CREATED_EVENT_TYPE,
  linkCreatedEvent,
} from '@linkvault/shared';
import mongoose, { type ClientSession, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MongoOutbox } from './mongo-outbox';
import {
  OUTBOX_EVENT_MODEL_NAME,
  OUTBOX_EVENTS_COLLECTION,
  type OutboxEventDocument,
} from './outbox-event.schemas';
import { MovableOutboxClock } from './testing/movable-outbox-clock';

// Escritura transaccional del outbox (tarea 4.1, D6 de job-links, ADR-009) contra el MongoMemoryReplSet del preset de
// `@linkvault/testing`: el evento y el agregado comparten transacción, así que hace falta el replica set.
//
// El agregado de verdad (`job_links` y su relación) llega con `save-link`; aquí lo representa una colección propia del
// test, porque lo que se comprueba es la transacción compartida, no la forma del link.

const AGGREGATES = 'outbox_spec_aggregates';
const now = new Date('2026-09-17T10:00:00.000Z');

let connection: Connection;
let clock: MovableOutboxClock;
let outbox: MongoOutbox;

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `outbox-${randomUUID()}` })
    .asPromise();
  clock = new MovableOutboxClock(now);
  outbox = new MongoOutbox(connection, clock);
  await connection.model(OUTBOX_EVENT_MODEL_NAME).init();
});

afterEach(async () => {
  clock.set(now);
  await connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});
  await connection.collection(AGGREGATES).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

/** Ejecuta `work` en una transacción y cierra la sesión pase lo que pase, como hacen los repositorios del módulo. */
async function withTransaction<T>(
  work: (session: ClientSession) => Promise<T>,
): Promise<T> {
  const session = await connection.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}

function pendingEvents(): Promise<OutboxEventDocument[]> {
  return connection
    .collection<OutboxEventDocument>(OUTBOX_EVENTS_COLLECTION)
    .find({})
    .toArray();
}

describe('MongoOutbox', () => {
  it('Alta con evento', async () => {
    const linkId = new mongoose.Types.ObjectId().toHexString();

    await withTransaction(async (session) => {
      await connection
        .collection(AGGREGATES)
        .insertOne({ linkId, sharedAt: now }, { session });
      await outbox.append(
        linkCreatedEvent({ linkId, previewVersion: 1 }),
        session,
      );
    });

    await expect(
      connection.collection(AGGREGATES).countDocuments(),
    ).resolves.toBe(1);
    const events = await pendingEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: LINK_CREATED_EVENT_TYPE,
      payload: { linkId, previewVersion: 1 },
      createdAt: now,
      publishedAt: null,
      failedAt: null,
      attempts: 0,
      // Vencido desde el primer instante: el relay lo toma en su siguiente vuelta.
      nextAttemptAt: now,
    });
  });

  it('Fallo al escribir el evento', async () => {
    const linkId = new mongoose.Types.ObjectId().toHexString();

    // Un evento sin tipo no pasa la validación del schema, así que la escritura falla dentro de la transacción.
    await expect(
      withTransaction(async (session) => {
        await connection
          .collection(AGGREGATES)
          .insertOne({ linkId, sharedAt: now }, { session });
        await outbox.append({ type: '', payload: { linkId } }, session);
      }),
    ).rejects.toThrow();

    await expect(
      connection.collection(AGGREGATES).countDocuments(),
    ).resolves.toBe(0);
    await expect(pendingEvents()).resolves.toEqual([]);
  });

  it('writes every state field explicitly instead of leaving it out', async () => {
    const linkId = new mongoose.Types.ObjectId().toHexString();

    await withTransaction((session) =>
      outbox.append(linkCreatedEvent({ linkId, previewVersion: 1 }), session),
    );

    const [event] = await pendingEvents();
    expect(Object.keys(event ?? {}).sort()).toEqual([
      '_id',
      'attempts',
      'createdAt',
      'failedAt',
      'nextAttemptAt',
      'payload',
      'publishedAt',
      'type',
    ]);
  });

  it('dates the event with the outbox clock, not with the server time', async () => {
    const later = new Date('2026-09-18T12:30:00.000Z');
    clock.set(later);
    const linkId = new mongoose.Types.ObjectId().toHexString();

    await withTransaction((session) =>
      outbox.append(linkCreatedEvent({ linkId, previewVersion: 2 }), session),
    );

    const [event] = await pendingEvents();
    expect(event?.createdAt).toEqual(later);
    expect(event?.nextAttemptAt).toEqual(later);
  });

  it('indexes the pending events that are due, and only those', async () => {
    const indexes = await connection
      .collection(OUTBOX_EVENTS_COLLECTION)
      .indexes();

    expect(indexes).toContainEqual(
      expect.objectContaining({
        key: { nextAttemptAt: 1, createdAt: 1 },
        partialFilterExpression: { publishedAt: null, failedAt: null },
      }),
    );
  });
});
