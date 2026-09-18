import {
  updatePreviewResponseSchema,
  type GroupDetail,
  type JobLinkSummary,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import mongoose from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import {
  enrichedPreview,
  jobLinkDraft,
} from '../application/testing/link-fixtures';
import {
  GROUP_LINKS_COLLECTION,
  JOB_LINKS_COLLECTION,
} from '../infrastructure/link.schemas';

// `PATCH /api/links/:id/preview` (tarea 6.3) sobre la app completa: la edición manual llega hasta Mongo con su
// procedencia y su versión, y lo que se responde es el link tal y como lo pinta una tarjeta.

const READ_AT = new Date('2026-09-18T11:00:00.000Z');

describe('manual preview editing', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let stranger: TestMember;
  let group: GroupDetail;

  beforeAll(async () => {
    http = await createLinksTestApp('links-preview-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    stranger = await http.authenticated('Extraño');
    group = await http.createGroup(ana, 'Backend Bolivia');
    await http.join(beto, group);
  });

  afterAll(async () => {
    await http.close();
  });

  /** Oferta ya leída y compartida en el grupo, con su procedencia por campo. */
  async function readOffer(slug: string): Promise<string> {
    const draft = jobLinkDraft(`https://empresa.example/careers/${slug}`, {
      createdBy: ana.userId,
      now: READ_AT,
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
      previewStatus: 'enriched',
      previewVersion: 2,
      ...enrichedPreview(ana.userId),
      previewRequestedAt: READ_AT,
      createdBy: new mongoose.Types.ObjectId(ana.userId),
      createdAt: READ_AT,
      updatedAt: READ_AT,
    });
    await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new mongoose.Types.ObjectId(group.id),
      linkId,
      sharedBy: new mongoose.Types.ObjectId(ana.userId),
      sharedAt: READ_AT,
    });
    return linkId.toHexString();
  }

  function patch(member: TestMember, linkId: string, body: unknown) {
    return http.request('PATCH', `/api/links/${linkId}/preview`, {
      authorization: member.authorization,
      body,
    });
  }

  async function edit(
    member: TestMember,
    linkId: string,
    body: unknown,
  ): Promise<JobLinkSummary> {
    const response = await patch(member, linkId, body);
    expect(response.statusCode).toBe(200);
    return updatePreviewResponseSchema.parse(response.json());
  }

  it('Corregir el título', async () => {
    const linkId = await readOffer('corregir-titulo');

    const summary = await edit(beto, linkId, {
      fields: { title: 'Ingeniero de Backend' },
    });

    expect(summary.preview?.title).toBe('Ingeniero de Backend');
    expect(summary.previewStatus).toBe('manual');
    expect(summary.previewVersion).toBe(3);
    const title = summary.previewSources?.title;
    expect(title?.source === 'manual' ? title.by : undefined).toEqual({
      userId: beto.userId,
      displayName: 'Beto',
    });
    // Lo guardado, no solo lo respondido.
    const stored = await http.connection
      .collection(JOB_LINKS_COLLECTION)
      .findOne({ _id: new mongoose.Types.ObjectId(linkId) });
    expect(stored?.['preview']).toMatchObject({ title: 'Ingeniero de Backend' });
    expect(stored?.['previewStatus']).toBe('manual');
    expect(stored?.['previewVersion']).toBe(3);
  });

  it('Link que no se puede ver', async () => {
    const linkId = await readOffer('ajeno');

    const foreign = await patch(stranger, linkId, {
      fields: { title: 'Mío' },
    });
    const malformed = await patch(ana, 'no-es-un-id', {
      fields: { title: 'Mío' },
    });

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'link_not_found',
      message: expect.any(String),
    });
    expect(malformed.statusCode).toBe(404);
  });

  it('Campo desconocido', async () => {
    const linkId = await readOffer('campo-desconocido');

    const response = await patch(ana, linkId, {
      fields: { image: 'https://example.com/a.png' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'preview_field_unknown',
      message: expect.any(String),
      fields: ['image'],
    });
  });

  it('Volver a lo extraído', async () => {
    const linkId = await readOffer('volver-a-lo-extraido');
    await edit(ana, linkId, { fields: { title: 'Ingeniero de Backend' } });

    const summary = await edit(ana, linkId, { revert: ['title'] });

    expect(summary.preview?.title).toBe('Backend Engineer');
    expect(summary.previewSources?.title?.source).toBe('auto');
    expect(summary.previewVersion).toBe(4);
  });

  it('keeps a value that is not a string, with its shape', async () => {
    const linkId = await readOffer('habilidades');

    const summary = await edit(ana, linkId, {
      fields: { skills: [{ name: 'TypeScript', required: true }] },
    });

    expect(summary.preview?.skills).toEqual([
      { name: 'TypeScript', required: true },
    ]);
  });

  it('answers 401 without a session', async () => {
    const linkId = await readOffer('sin-sesion');

    const response = await http.request(
      'PATCH',
      `/api/links/${linkId}/preview`,
      { body: { fields: { title: 'Mío' } } },
    );

    expect(response.statusCode).toBe(401);
  });
});
