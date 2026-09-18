import {
  enrichLinkResponseSchema,
  LINK_CREATED_EVENT_TYPE,
  linkCreatedJobId,
  type EnrichmentFailureReason,
  type GroupDetail,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OUTBOX_EVENTS_COLLECTION } from '../../../infrastructure/outbox/outbox-event.schemas';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { ENRICH_RETRIES_PER_LINK } from '../domain/limits';
import { jobLinkDraft } from '../application/testing/link-fixtures';
import {
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
} from '../infrastructure/link.schemas';

// `POST /api/links/:id/enrich` (tarea 6.4) sobre la app completa. Esta suite NO abre Redis para encolar nada: la
// petición se escribe en `outbox_events` dentro de la transacción, que es justo lo que D10 eligió para no obligar a la
// integración de `api` a levantar la cola.

/** Anterior a cualquier ejecución del test: `previewRequestedAt` tiene que quedar por delante de esta fecha. */
const FAILED_AT = new Date('2026-01-02T03:04:05.000Z');

describe('asking for a job offer to be read again', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let stranger: TestMember;
  let group: GroupDetail;

  beforeAll(async () => {
    http = await createLinksTestApp('links-enrich-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    stranger = await http.authenticated('Extraño');
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
  });

  afterAll(async () => {
    await http.close();
  });

  /** Oferta compartida en el grupo que quedó fallida por ese motivo. */
  async function failedOffer(
    slug: string,
    reason: EnrichmentFailureReason,
  ): Promise<string> {
    const draft = jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: ana.userId,
      now: FAILED_AT,
    });
    const linkId = new mongoose.Types.ObjectId();
    await http.connection.collection(JOB_LINKS_COLLECTION).insertOne({
      _id: linkId,
      normalizedUrl: draft.normalizedUrl,
      urlHash: draft.urlHash,
      dedupeKey: draft.dedupeKey,
      platform: draft.platform,
      displayUrl: draft.displayUrl,
      originalUrls: [...draft.originalUrls],
      previewStatus: 'failed',
      previewVersion: 2,
      lastEnrichmentError: { reason, at: FAILED_AT.toISOString() },
      previewRequestedAt: FAILED_AT,
      createdBy: new mongoose.Types.ObjectId(ana.userId),
      createdAt: FAILED_AT,
      updatedAt: FAILED_AT,
    });
    await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new mongoose.Types.ObjectId(group.id),
      linkId,
      sharedBy: new mongoose.Types.ObjectId(ana.userId),
      sharedAt: FAILED_AT,
    });
    return linkId.toHexString();
  }

  function enrich(member: TestMember, linkId: string) {
    return http.request('POST', `/api/links/${linkId}/enrich`, {
      authorization: member.authorization,
    });
  }

  async function pendingEventsOf(linkId: string): Promise<unknown[]> {
    return await http.connection
      .collection(OUTBOX_EVENTS_COLLECTION)
      .find({ type: LINK_CREATED_EVENT_TYPE, 'payload.linkId': linkId })
      .toArray();
  }

  it('Reintento aceptado', async () => {
    const linkId = await failedOffer('reintento-aceptado', 'timeout');

    const response = await enrich(beto, linkId);

    expect(response.statusCode).toBe(202);
    const summary = enrichLinkResponseSchema.parse(response.json());
    expect(summary.previewStatus).toBe('pending');
    expect(summary.previewVersion).toBe(3);
    expect(summary.lastEnrichmentError).toBeUndefined();
    const stored = await http.connection
      .collection(JOB_LINKS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
    expect(stored?.['previewStatus']).toBe('pending');
    expect(stored?.['lastEnrichmentError']).toBeUndefined();
    expect(
      new Date(String(stored?.['previewRequestedAt'])).getTime(),
    ).toBeGreaterThan(FAILED_AT.getTime());
  });

  it('Reintento con trabajo terminal retenido', async () => {
    const linkId = await failedOffer('trabajo-retenido', 'host_busy');

    await enrich(ana, linkId);

    const events = await pendingEventsOf(linkId);
    expect(events).toHaveLength(1);
    // La petición va por el outbox y con una versión nueva, así que su `jobId` no es el del intento anterior.
    expect(linkCreatedJobId({ linkId, previewVersion: 3 })).not.toBe(
      linkCreatedJobId({ linkId, previewVersion: 2 }),
    );
    expect(events[0]).toMatchObject({
      payload: { linkId, previewVersion: 3 },
      publishedAt: null,
      failedAt: null,
    });
  });

  it('Reintento inútil', async () => {
    const linkId = await failedOffer('reintento-inutil', 'robots_disallowed');

    const response = await enrich(ana, linkId);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'enrichment_not_retryable',
      message: expect.any(String),
    });
    expect(await pendingEventsOf(linkId)).toHaveLength(0);
  });

  it('Demasiados reintentos', async () => {
    const linkId = await failedOffer('demasiados', 'timeout');

    const accepted: number[] = [];
    for (let attempt = 0; attempt <= ENRICH_RETRIES_PER_LINK; attempt += 1) {
      accepted.push((await enrich(ana, linkId)).statusCode);
    }
    const last = accepted.at(-1);

    expect(accepted.slice(0, ENRICH_RETRIES_PER_LINK)).toEqual(
      Array.from({ length: ENRICH_RETRIES_PER_LINK }, () => 202),
    );
    expect(last).toBe(429);
  });

  it('answers 429 with Retry-After and no event written', async () => {
    const linkId = await failedOffer('cabecera-retry', 'timeout');
    for (let attempt = 0; attempt < ENRICH_RETRIES_PER_LINK; attempt += 1) {
      await enrich(ana, linkId);
    }

    const response = await enrich(beto, linkId);

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({ code: 'too_many_attempts' });
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(await pendingEventsOf(linkId)).toHaveLength(
      ENRICH_RETRIES_PER_LINK,
    );
  });

  it('answers 404 to somebody who cannot see the link, and to a malformed id', async () => {
    const linkId = await failedOffer('ajeno-enrich', 'timeout');

    const foreign = await enrich(stranger, linkId);
    const malformed = await enrich(ana, 'no-es-un-id');

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: 'link_not_found' });
    expect(malformed.statusCode).toBe(404);
  });

  it('answers 401 without a session', async () => {
    const linkId = await failedOffer('sin-sesion-enrich', 'timeout');

    const response = await http.request(
      'POST',
      `/api/links/${linkId}/enrich`,
      {},
    );

    expect(response.statusCode).toBe(401);
  });
});
