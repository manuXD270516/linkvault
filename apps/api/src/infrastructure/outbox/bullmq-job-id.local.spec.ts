import {
  APPLICATION_STATUS_NOTIFY_EVENT_TYPE,
  CV_DELETED_EVENT_TYPE,
  CV_UPLOADED_EVENT_TYPE,
  GROUP_LINK_ADDED_EVENT_TYPE,
  LINK_CREATED_EVENT_TYPE,
  MATCH_REQUESTED_EVENT_TYPE,
  ROADMAP_REQUESTED_EVENT_TYPE,
} from '@linkvault/shared';
import { Queue } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTBOX_ROUTES } from './outbox-routes';

// **Paso local, no de CI**: la suite de `api` no levanta Redis (ADR-021 §4), así que este es el único sitio donde el
// `jobId` de cada tipo llega a la validación **de verdad** de BullMQ.
//
// Existe por el defecto que llegó al e2e: `extract-cv:<cvId>` tiene dos segmentos y BullMQ lo rechaza con
// `Custom Id cannot contain :`. La red que protege en CI es el test de contrato de `outbox-routes.spec.ts`, que
// replica esa regla sobre toda la tabla; este de aquí es el que comprueba que la regla replicada es **la de verdad**.
//
// Se enciende con `OUTBOX_REDIS_LOCAL=1` y la infraestructura levantada:
//
//   docker compose up -d --wait
//   OUTBOX_REDIS_LOCAL=1 pnpm nx run api:test -- bullmq-job-id.local
//
// Usa una cola de sonda propia y la borra al terminar: no toca `enrich-link`, `extract-cv`, `delete-cv-file` ni
// `analyze-match`.

const enabled = process.env['OUTBOX_REDIS_LOCAL'] === '1';
const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const PROBE_QUEUE = 'outbox-job-id-probe';

const payloads: Readonly<Record<string, Record<string, unknown>>> = {
  [LINK_CREATED_EVENT_TYPE]: { linkId: 'l1', previewVersion: 1 },
  [CV_UPLOADED_EVENT_TYPE]: { cvId: 'c1', userId: 'u1' },
  [CV_DELETED_EVENT_TYPE]: { cvId: 'c1', userId: 'u1' },
  [MATCH_REQUESTED_EVENT_TYPE]: {
    analysisId: 'a1',
    userId: 'u1',
    linkId: 'l1',
    cvId: 'c1',
  },
  [ROADMAP_REQUESTED_EVENT_TYPE]: {
    analysisId: 'a1',
    userId: 'u1',
  },
  [GROUP_LINK_ADDED_EVENT_TYPE]: {
    groupId: 'g1',
    linkId: 'l1',
    actorUserId: 'u1',
  },
  [APPLICATION_STATUS_NOTIFY_EVENT_TYPE]: {
    applicationId: 'a1',
    linkId: 'l1',
    actorUserId: 'u1',
    status: 'applied',
    statusChangedAt: '2026-09-22T12:00:00.000Z',
  },
};

let queue: Queue | undefined;

describe.skipIf(!enabled)('the jobId of every route, against a real BullMQ', () => {
  beforeAll(() => {
    queue = new Queue(PROBE_QUEUE, {
      connection: { url: redisUrl, maxRetriesPerRequest: null },
    });
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await queue?.close();
    queue = undefined;
  });

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s is accepted by the queue',
    async (type) => {
      const job = OUTBOX_ROUTES[type]?.job(payloads[type] ?? {});
      if (job === undefined || queue === undefined) {
        throw new Error(`no route or queue for ${type}`);
      }

      const added = await queue.add(type, job.data, { jobId: job.jobId });

      expect(added.id).toBe(job.jobId);
      await expect(queue.getJob(job.jobId)).resolves.toBeDefined();
    },
    30_000,
  );

  it('rejects a two-segment id, which is the shape that broke', async () => {
    if (queue === undefined) {
      throw new Error('no queue');
    }

    await expect(
      queue.add('probe', {}, { jobId: 'extract-cv:c1' }),
    ).rejects.toThrow(/Custom Id cannot contain :/);
  });
});
