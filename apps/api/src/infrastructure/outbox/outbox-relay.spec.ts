import { randomUUID } from 'node:crypto';
import {
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  cvDeletedEvent,
  cvUploadedEvent,
  linkCreatedEvent,
  linkCreatedJobId,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose, { type ClientSession, type Connection } from 'mongoose';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { BullmqOutboxPublisher, type JobQueue } from './bullmq-outbox-publisher';
import { MongoOutbox } from './mongo-outbox';
import {
  OUTBOX_EVENTS_COLLECTION,
  OUTBOX_EVENT_MODEL_NAME,
  outboxEventSchema,
  type OutboxEventDocument,
} from './outbox-event.schemas';
import {
  OUTBOX_MAX_RETRY_DELAY_MS,
  OUTBOX_RELAY_INTERVAL_NAME,
  OutboxRelay,
  outboxRetryDelayMs,
  type IntervalScheduler,
  type RelayLogWriter,
} from './outbox-relay';
import { MovableOutboxClock } from './testing/movable-outbox-clock';

// Relay del outbox (tarea 4.2, D6 de job-links, ADR-009) contra Mongo real y una cola falsa, con el reloj movible: lo
// que se comprueba es la publicación con `jobId` determinista, el marcado posterior y que un fallo de la cola deja el
// evento pendiente en lugar de perderlo.

const now = new Date('2026-09-17T10:00:00.000Z');
const INTERVAL_MS = 1_000;

let connection: Connection;
let clock: MovableOutboxClock;
let outbox: MongoOutbox;
let queue: FakeJobQueue;
let cvQueues: ReadonlyMap<string, FakeJobQueue>;
let relay: OutboxRelay;
let scheduler: RecordingScheduler;
let log: RecordingLog;

/** Cola falsa con la regla que importa de BullMQ: un `jobId` repetido no crea un segundo job. */
class FakeJobQueue implements JobQueue {
  readonly jobs = new Map<string, { name: string; data: unknown }>();
  /** Con `down`, encolar rechaza en el acto, como una conexión que falla rápido. */
  down = false;
  added = 0;

  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string },
  ): Promise<unknown> {
    if (this.down) {
      return Promise.reject(new Error('Connection is closed'));
    }
    this.added += 1;
    if (!this.jobs.has(options.jobId)) {
      this.jobs.set(options.jobId, { name, data });
    }
    return Promise.resolve({ id: options.jobId });
  }
}

class RecordingScheduler implements IntervalScheduler {
  readonly intervals = new Map<string, NodeJS.Timeout>();

  addInterval(name: string, intervalId: NodeJS.Timeout): void {
    this.intervals.set(name, intervalId);
  }

  clear(): void {
    for (const interval of this.intervals.values()) {
      clearInterval(interval);
    }
    this.intervals.clear();
  }
}

class RecordingLog implements RelayLogWriter {
  readonly warnings: string[] = [];
  readonly debugs: string[] = [];

  warn(message: string): void {
    this.warnings.push(message);
  }

  debug(message: string): void {
    this.debugs.push(message);
  }
}

beforeAll(async () => {
  connection = await mongoose
    .createConnection(getMongoTestUri(), { dbName: `relay-${randomUUID()}` })
    .asPromise();
  await connection
    .model<OutboxEventDocument>(OUTBOX_EVENT_MODEL_NAME, outboxEventSchema)
    .init();
});

beforeEach(() => {
  clock = new MovableOutboxClock(now);
  outbox = new MongoOutbox(connection, clock);
  queue = new FakeJobQueue();
  cvQueues = new Map([
    [EXTRACT_CV_QUEUE, new FakeJobQueue()],
    [DELETE_CV_FILE_QUEUE, new FakeJobQueue()],
  ]);
  scheduler = new RecordingScheduler();
  log = new RecordingLog();
  relay = new OutboxRelay(
    outbox,
    new BullmqOutboxPublisher(
      new Map<string, JobQueue>([[ENRICH_LINK_QUEUE, queue], ...cvQueues]),
    ),
    clock,
    INTERVAL_MS,
    scheduler,
    log,
  );
});

afterEach(async () => {
  scheduler.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
  await connection.collection(OUTBOX_EVENTS_COLLECTION).deleteMany({});
});

afterAll(async () => {
  await connection.dropDatabase();
  await connection.close();
});

/** Escribe un evento pendiente como lo haría el alta de un link: dentro de una transacción. */
async function appendLinkCreated(linkId: string, previewVersion = 1) {
  const session = await connection.startSession();
  try {
    await session.withTransaction((active: ClientSession) =>
      outbox.append(linkCreatedEvent({ linkId, previewVersion }), active),
    );
  } finally {
    await session.endSession();
  }
}

function storedEvents(): Promise<OutboxEventDocument[]> {
  return connection
    .collection<OutboxEventDocument>(OUTBOX_EVENTS_COLLECTION)
    .find({})
    .toArray();
}

function newLinkId(): string {
  return new mongoose.Types.ObjectId().toHexString();
}

/** Escribe cualquier evento pendiente, como lo haría el alta que lo produce: dentro de una transacción. */
async function appendEvent(event: {
  type: string;
  payload: Record<string, unknown>;
}) {
  const session = await connection.startSession();
  try {
    await session.withTransaction((active: ClientSession) =>
      outbox.append(event, active),
    );
  } finally {
    await session.endSession();
  }
}

describe('OutboxRelay', () => {
  it('Publicación correcta', async () => {
    const linkId = newLinkId();
    await appendLinkCreated(linkId);

    await relay.publishPending();

    expect([...queue.jobs.keys()]).toEqual([
      linkCreatedJobId({ linkId, previewVersion: 1 }),
    ]);
    expect(queue.jobs.get(`enrich:${linkId}:1`)?.data).toEqual({
      linkId,
      previewVersion: 1,
    });
    const [event] = await storedEvents();
    expect(event?.publishedAt).toEqual(now);
    expect(event?.failedAt).toBeNull();
  });

  it('Cada evento a su cola', async () => {
    const linkId = newLinkId();
    const cvId = new mongoose.Types.ObjectId().toHexString();
    const userId = new mongoose.Types.ObjectId().toHexString();
    await appendLinkCreated(linkId);
    await appendEvent(cvUploadedEvent({ cvId, userId }));
    await appendEvent(cvDeletedEvent({ cvId, userId }));

    await relay.publishPending();

    expect([...queue.jobs.keys()]).toEqual([`enrich:${linkId}:1`]);
    expect([...(cvQueues.get(EXTRACT_CV_QUEUE)?.jobs.keys() ?? [])]).toEqual([
      `extract-cv:${cvId}`,
    ]);
    expect([
      ...(cvQueues.get(DELETE_CV_FILE_QUEUE)?.jobs.keys() ?? []),
    ]).toEqual([`delete-cv-file:${cvId}`]);
    const events = await storedEvents();
    expect(events.map((event) => event.publishedAt)).toEqual([now, now, now]);
  });

  it('Tipo desconocido', async () => {
    await appendEvent({ type: 'SomethingElse.v1', payload: { id: 'x' } });

    await relay.publishPending();

    expect(queue.added).toBe(0);
    for (const cvQueue of cvQueues.values()) {
      expect(cvQueue.added).toBe(0);
    }
    const [event] = await storedEvents();
    expect(event?.publishedAt).toBeNull();
    expect(event?.failedAt).toBeNull();
  });

  it('Contenido que no cumple su contrato', async () => {
    // Un `CvUploaded.v1` sin su `userId`: el schema del contrato lo rechaza antes de tocar la cola.
    await appendEvent({ type: 'CvUploaded.v1', payload: { cvId: 'c1' } });

    await relay.publishPending();

    expect(cvQueues.get(EXTRACT_CV_QUEUE)?.added).toBe(0);
    const [event] = await storedEvents();
    expect(event?.publishedAt).toBeNull();
    expect(event?.failedAt).toBeNull();
  });

  it('Relay que publica dos veces', async () => {
    const linkId = newLinkId();
    await appendLinkCreated(linkId);
    // La marca no se guarda: el evento sigue pendiente aunque la cola ya lo tenga.
    vi.spyOn(outbox, 'markPublished').mockRejectedValueOnce(
      new Error('write failed'),
    );

    await relay.publishPending();
    await relay.publishPending();

    expect(queue.added).toBe(2);
    expect(queue.jobs.size).toBe(1);
    const [event] = await storedEvents();
    expect(event?.publishedAt).toEqual(now);
  });

  it('publishes an event only once when the mark does get saved', async () => {
    await appendLinkCreated(newLinkId());

    await relay.publishPending();
    await relay.publishPending();

    expect(queue.added).toBe(1);
  });

  it('Cola caída al guardar', async () => {
    queue.down = true;
    const linkId = newLinkId();

    // El `201` de la petición, con la cola caída y el relay apagado, lo comprueba la integración HTTP del guardado
    // (`links.controller.save.spec`, mismo nombre de escenario): aquí no hay app, solo el relay y su cola.
    // Guardar no toca la cola: el evento queda escrito pase lo que pase con Redis.
    await appendLinkCreated(linkId);
    await relay.publishPending();

    expect(queue.jobs.size).toBe(0);
    const [event] = await storedEvents();
    expect(event?.publishedAt).toBeNull();
    expect(event?.failedAt).toBeNull();
    expect(event?.payload).toEqual({ linkId, previewVersion: 1 });
  });

  it('publishes the pending events oldest first', async () => {
    const first = newLinkId();
    await appendLinkCreated(first);
    clock.advanceBy(60_000);
    const second = newLinkId();
    await appendLinkCreated(second);

    await relay.publishPending();

    expect([...queue.jobs.keys()]).toEqual([
      `enrich:${first}:1`,
      `enrich:${second}:1`,
    ]);
  });

  it('leaves untouched the events whose retry is still in the future', async () => {
    const linkId = newLinkId();
    await appendLinkCreated(linkId);
    const [pending] = await storedEvents();
    await outbox.scheduleRetry(
      pending?._id.toHexString() ?? '',
      1,
      new Date(now.getTime() + 60_000),
    );

    await relay.publishPending();

    expect(queue.jobs.size).toBe(0);
  });

  it('registers one interval with the configured period', () => {
    vi.useFakeTimers();
    const pass = vi.spyOn(relay, 'publishPending').mockResolvedValue(undefined);

    relay.onModuleInit();
    vi.advanceTimersByTime(INTERVAL_MS * 3);

    expect([...scheduler.intervals.keys()]).toEqual([
      OUTBOX_RELAY_INTERVAL_NAME,
    ]);
    expect(pass).toHaveBeenCalledTimes(3);
  });

  it('does not start a pass while the previous one is still running', async () => {
    await appendLinkCreated(newLinkId());
    let release = (): void => undefined;
    const add = vi.spyOn(queue, 'add').mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(undefined);
        }),
    );

    const first = relay.publishPending();
    // Hasta que la cola no tiene la primera publicación en la mano, la vuelta todavía está leyendo Mongo.
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    await relay.publishPending();
    release();
    await first;

    expect(add).toHaveBeenCalledTimes(1);
    expect(queue.added).toBe(0);
  });

  it('Reintento tras un fallo de la cola', async () => {
    const linkId = newLinkId();
    await appendLinkCreated(linkId);
    queue.down = true;

    await relay.publishPending();
    const [afterFailure] = await storedEvents();
    expect(afterFailure).toMatchObject({
      attempts: 1,
      publishedAt: null,
      failedAt: null,
      // Primera espera: un segundo.
      nextAttemptAt: new Date(now.getTime() + 1_000),
    });

    // Antes de que venza la espera, el relay ni lo mira; cuando vence y la cola vuelve, lo publica una sola vez.
    clock.advanceBy(500);
    await relay.publishPending();
    expect(queue.added).toBe(0);

    clock.advanceBy(500);
    queue.down = false;
    await relay.publishPending();
    await relay.publishPending();

    expect(queue.added).toBe(1);
    expect([...queue.jobs.keys()]).toEqual([`enrich:${linkId}:1`]);
    const [published] = await storedEvents();
    expect(published?.publishedAt).toEqual(clock.now());
  });

  it('Corte largo de la cola', async () => {
    await appendLinkCreated(newLinkId());
    queue.down = true;

    // Una hora de cortes: cada vuelta espera un poco más, con el tope de cinco minutos.
    const deadline = now.getTime() + 3_600_000;
    let attempts = 0;
    while (clock.now().getTime() < deadline) {
      await relay.publishPending();
      attempts += 1;
      const [pending] = await storedEvents();
      clock.set(pending?.nextAttemptAt ?? clock.now());
    }
    const [waiting] = await storedEvents();
    expect(waiting?.attempts).toBe(attempts);
    expect(waiting?.failedAt).toBeNull();
    // Con el tope de 5 minutos, una hora son unas pocas decenas de intentos, no miles.
    expect(attempts).toBeLessThan(30);

    queue.down = false;
    await relay.publishPending();

    const [published] = await storedEvents();
    expect(published?.publishedAt).toEqual(clock.now());
    expect(published?.failedAt).toBeNull();
    expect(queue.jobs.size).toBe(1);
  });

  it('Evento agotado', async () => {
    const linkId = newLinkId();
    await appendLinkCreated(linkId);
    queue.down = true;
    await relay.publishPending();

    // Un día después, el evento sigue sin poder publicarse: se da por perdido.
    clock.advanceBy(86_400_000);
    await relay.publishPending();

    const [failed] = await storedEvents();
    const eventId = failed?._id.toHexString() ?? '';
    expect(failed?.failedAt).toEqual(clock.now());
    expect(failed?.publishedAt).toBeNull();
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]).toContain(eventId);
    expect(log.warnings[0]).not.toContain(linkId);

    // Agotado es definitivo: aunque la cola vuelva, el relay ya no lo toma.
    queue.down = false;
    await relay.publishPending();
    expect(queue.jobs.size).toBe(0);
  });

  it.each([
    [0, 1_000],
    [1, 2_000],
    [2, 4_000],
    [3, 8_000],
    [8, 256_000],
    [9, OUTBOX_MAX_RETRY_DELAY_MS],
    [40, OUTBOX_MAX_RETRY_DELAY_MS],
  ])('waits %i failures out for %i ms', (attempts, expected) => {
    expect(outboxRetryDelayMs(attempts)).toBe(expected);
  });

  it('survives a pass that cannot even read the pending events', async () => {
    vi.spyOn(outbox, 'takeDue').mockRejectedValueOnce(
      new Error('no primary available'),
    );

    await expect(relay.publishPending()).resolves.toBeUndefined();
    expect(log.warnings).toEqual([]);
    expect(log.debugs).toHaveLength(1);
  });
});
