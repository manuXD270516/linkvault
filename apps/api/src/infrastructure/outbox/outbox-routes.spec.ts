import {
  ANALYZE_MATCH_QUEUE,
  BUILD_ROADMAP_QUEUE,
  CV_DELETED_EVENT_TYPE,
  CV_UPLOADED_EVENT_TYPE,
  DELETE_CV_FILE_QUEUE,
  ENRICH_LINK_QUEUE,
  EXTRACT_CV_QUEUE,
  LINK_CREATED_EVENT_TYPE,
  MATCH_REQUESTED_EVENT_TYPE,
  ROADMAP_REQUESTED_EVENT_TYPE,
} from '@linkvault/shared';
import { describe, expect, it } from 'vitest';
import {
  OUTBOX_QUEUES,
  OUTBOX_ROUTES,
  outboxRouteOf,
} from './outbox-routes';

describe('the outbox routing table', () => {
  it('covers exactly the event types declared in the shared contract', () => {
    expect(Object.keys(OUTBOX_ROUTES).sort()).toEqual(
      [
        LINK_CREATED_EVENT_TYPE,
        CV_UPLOADED_EVENT_TYPE,
        CV_DELETED_EVENT_TYPE,
        MATCH_REQUESTED_EVENT_TYPE,
        ROADMAP_REQUESTED_EVENT_TYPE,
      ].sort(),
    );
  });

  it('gives every type its own queue', () => {
    const queues = Object.values(OUTBOX_ROUTES).map((route) => route.queue);

    expect(queues).toEqual([
      ENRICH_LINK_QUEUE,
      EXTRACT_CV_QUEUE,
      DELETE_CV_FILE_QUEUE,
      ANALYZE_MATCH_QUEUE,
      BUILD_ROADMAP_QUEUE,
    ]);
    expect(new Set(queues).size).toBe(queues.length);
  });

  it('lists the queues the relay has to register', () => {
    expect([...OUTBOX_QUEUES].sort()).toEqual(
      [
        ENRICH_LINK_QUEUE,
        EXTRACT_CV_QUEUE,
        DELETE_CV_FILE_QUEUE,
        ANALYZE_MATCH_QUEUE,
        BUILD_ROADMAP_QUEUE,
      ].sort(),
    );
  });

  it('builds the deterministic job of each type from its own contract', () => {
    expect(
      outboxRouteOf(LINK_CREATED_EVENT_TYPE)?.job({
        linkId: 'l1',
        previewVersion: 1,
      }),
    ).toEqual({ data: { linkId: 'l1', previewVersion: 1 }, jobId: 'enrich:l1:1' });
    expect(
      outboxRouteOf(CV_UPLOADED_EVENT_TYPE)?.job({ cvId: 'c1', userId: 'u1' }),
    ).toEqual({
      data: { cvId: 'c1', userId: 'u1' },
      jobId: 'cv:c1:extract',
    });
    expect(
      outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({ cvId: 'c1', userId: 'u1' }),
    ).toEqual({
      data: { cvId: 'c1', userId: 'u1' },
      jobId: 'cv:c1:delete',
    });
    expect(
      outboxRouteOf(MATCH_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
        linkId: 'l1',
        cvId: 'c1',
      }),
    ).toEqual({
      data: { analysisId: 'a1', userId: 'u1', linkId: 'l1', cvId: 'c1' },
      jobId: 'match:a1:analyze',
    });
    expect(
      outboxRouteOf(ROADMAP_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
      }),
    ).toEqual({
      data: { analysisId: 'a1', userId: 'u1' },
      jobId: 'roadmap:a1:build',
    });
  });

  it('throws when the payload does not meet its schema', () => {
    expect(() =>
      outboxRouteOf(CV_UPLOADED_EVENT_TYPE)?.job({ cvId: 'c1' }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({
        cvId: 'c1',
        userId: 'u1',
        fileName: 'CV_Ana_Perez.pdf',
      }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(MATCH_REQUESTED_EVENT_TYPE)?.job({
        analysisId: 'a1',
        userId: 'u1',
        linkId: 'l1',
      }),
    ).toThrow();
    expect(() =>
      outboxRouteOf(ROADMAP_REQUESTED_EVENT_TYPE)?.job({ analysisId: 'a1' }),
    ).toThrow();
  });

  it('does not know an unknown type, nor anything inherited from Object', () => {
    expect(outboxRouteOf('Whatever.v9')).toBeUndefined();
    expect(outboxRouteOf('toString')).toBeUndefined();
  });
});

// El `jobId` de cada tipo, contra las reglas que BullMQ aplica **en la cola de verdad** (`Job.addJob`, bullmq 6.3.6).
//
// Este bloque existe por un defecto que llegó al e2e: `extract-cv:<cvId>` tiene dos puntos y dos segmentos, y BullMQ
// lo rechaza con `Custom Id cannot contain :`. Como todos los unitarios publican contra una cola doble, esa validación
// no se ejecutaba nunca: el relay reintentaba, registraba el fallo en `debug` y el CV se quedaba en `pending` para
// siempre sin que nada lo dijera. El síntoma visible era `attempts` creciendo en `outbox_events`.
//
// La regla se replica aquí, sobre **todas** las rutas de la tabla, para que un evento nuevo con un `jobId` mal formado
// falle en CI y no en producción.
//
// La cobertura compara las claves de `payloads` con las de `OUTBOX_ROUTES` (no la longitud de una lista derivada de
// esa misma tabla, que nunca fallaría). Una ruta ausente de `payloads` falla **nombrando la ruta** antes de derivar
// ningún `jobId`, para no enmascarar el olvido con un `ZodError` de `?? {}`.
describe('the jobId of every route, against the rules of BullMQ', () => {
  /** Un payload plausible por tipo: lo que importa es la **forma** del `jobId`, no su contenido. */
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
  };

  it('covers every route, so a new event cannot slip past this check', () => {
    expect(Object.keys(payloads).sort()).toEqual(
      Object.keys(OUTBOX_ROUTES).sort(),
    );
  });

  function jobIdOf(type: string): string {
    const payload = payloads[type];
    expect(payload, `missing payload for outbox route ${type}`).toBeDefined();
    const route = OUTBOX_ROUTES[type];
    expect(route, `missing outbox route ${type}`).toBeDefined();
    return route!.job(payload!).jobId;
  }

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: with a colon, it has exactly three segments',
    (type) => {
      const jobId = jobIdOf(type);
      // `Job.addJob`: `jobId.includes(':') && jobId.split(':').length !== 3` → `Custom Id cannot contain :`.
      if (jobId.includes(':')) {
        expect(jobId.split(':')).toHaveLength(3);
      }
    },
  );

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: it is not a plain integer',
    (type) => {
      const jobId = jobIdOf(type);
      // `Job.addJob`: `${parseInt(jobId, 10)} === jobId` → `Custom Id cannot be integers`.
      expect(String(Number.parseInt(jobId, 10))).not.toBe(jobId);
    },
  );

  it.each(Object.keys(OUTBOX_ROUTES))(
    '%s: it is not empty and carries its identifier',
    (type) => {
      const jobId = jobIdOf(type);
      expect(jobId.length).toBeGreaterThan(0);
      expect(jobId).toContain('1');
    },
  );

  it('gives a different jobId to each type of the same CV', () => {
    const extract = outboxRouteOf(CV_UPLOADED_EVENT_TYPE)?.job({
      cvId: 'c1',
      userId: 'u1',
    }).jobId;
    const remove = outboxRouteOf(CV_DELETED_EVENT_TYPE)?.job({
      cvId: 'c1',
      userId: 'u1',
    }).jobId;

    expect(extract).not.toBe(remove);
  });

  it('keeps the jobId deterministic: the same event republished is the same job', () => {
    for (const type of Object.keys(OUTBOX_ROUTES)) {
      const jobId = jobIdOf(type);
      expect(OUTBOX_ROUTES[type]?.job(payloads[type]!).jobId).toBe(jobId);
    }
  });
});
