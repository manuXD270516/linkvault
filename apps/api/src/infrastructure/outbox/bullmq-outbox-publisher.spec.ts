import {
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
} from '@linkvault/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BullmqOutboxPublisher,
  type JobQueue,
} from './bullmq-outbox-publisher';
import type { PendingOutboxEvent } from './mongo-outbox';

// Publicación por el relay (spec `platform/outbox`, D11 de cv-upload-extract): cada tipo a su cola, con el `jobId` de
// su contrato, y nada encolado cuando el tipo no se conoce o el contenido no cumple su schema.

class RecordingQueue implements JobQueue {
  readonly jobs: { name: string; data: unknown; jobId: string }[] = [];

  add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string },
  ): Promise<unknown> {
    this.jobs.push({ name, data, jobId: options.jobId });
    return Promise.resolve({ id: options.jobId });
  }
}

const event = (
  type: string,
  payload: Record<string, unknown>,
): PendingOutboxEvent =>
  ({ id: 'e1', type, payload }) as unknown as PendingOutboxEvent;

let queues: Map<string, RecordingQueue>;
let publisher: BullmqOutboxPublisher;

beforeEach(() => {
  queues = new Map([
    [ENRICH_LINK_QUEUE, new RecordingQueue()],
    [EXTRACT_CV_QUEUE, new RecordingQueue()],
    [DELETE_CV_FILE_QUEUE, new RecordingQueue()],
  ]);
  publisher = new BullmqOutboxPublisher(queues);
});

function added(): { queue: string; jobId: string }[] {
  return [...queues].flatMap(([queue, recorder]) =>
    recorder.jobs.map((job) => ({ queue, jobId: job.jobId })),
  );
}

describe('BullmqOutboxPublisher', () => {
  it('publishes a link creation on the enrichment queue', async () => {
    await publisher.publish(
      event('LinkCreated.v1', { linkId: 'l1', previewVersion: 2 }),
    );

    expect(added()).toEqual([
      { queue: ENRICH_LINK_QUEUE, jobId: 'enrich:l1:2' },
    ]);
    expect(queues.get(ENRICH_LINK_QUEUE)?.jobs[0]?.data).toEqual({
      linkId: 'l1',
      previewVersion: 2,
    });
  });

  it('publishes a CV upload on the extraction queue', async () => {
    await publisher.publish(
      event('CvUploaded.v1', { cvId: 'c1', userId: 'u1' }),
    );

    expect(added()).toEqual([
      { queue: EXTRACT_CV_QUEUE, jobId: 'cv:c1:extract' },
    ]);
  });

  it('publishes a CV deletion on the file deletion queue', async () => {
    await publisher.publish(event('CvDeleted.v1', { cvId: 'c1', userId: 'u1' }));

    expect(added()).toEqual([
      { queue: DELETE_CV_FILE_QUEUE, jobId: 'cv:c1:delete' },
    ]);
  });

  it('throws on an unknown type instead of enqueueing it anywhere', async () => {
    await expect(publisher.publish(event('Whatever.v1', {}))).rejects.toThrow(
      /Unknown outbox event type/,
    );

    expect(added()).toEqual([]);
  });

  it('throws when the payload does not meet its schema, and enqueues nothing', async () => {
    await expect(
      publisher.publish(event('CvUploaded.v1', { cvId: 'c1' })),
    ).rejects.toThrow();
    await expect(
      publisher.publish(
        event('CvDeleted.v1', {
          cvId: 'c1',
          userId: 'u1',
          fileName: 'CV_Ana_Perez.pdf',
        }),
      ),
    ).rejects.toThrow();

    expect(added()).toEqual([]);
  });

  it('throws when its queue is not registered, leaving the event pending', async () => {
    const withoutCv = new BullmqOutboxPublisher(
      new Map([[ENRICH_LINK_QUEUE, new RecordingQueue()]]),
    );

    await expect(
      withoutCv.publish(event('CvUploaded.v1', { cvId: 'c1', userId: 'u1' })),
    ).rejects.toThrow(/No queue registered/);
  });
});
