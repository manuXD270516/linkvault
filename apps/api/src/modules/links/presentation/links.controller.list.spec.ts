import { linkPageSchema, type GroupDetail, type LinkPage } from '@linkvault/shared';
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

// `GET /api/groups/:id/links` y `GET /api/links/mine` (tarea 5.8 de job-links) sobre la app completa.

const MALFORMED_ID = 'no-es-un-id';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const COMPUTRABAJO =
  'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718';

describe('link listings', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let beto: TestMember;
  let stranger: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp('links-list-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
    beto = await http.authenticated('Beto');
    stranger = await http.authenticated('Extraño');
  });

  afterAll(async () => {
    await http.close();
  });

  async function groupOf(owner: TestMember, name: string, ...members: TestMember[]) {
    const group = await http.createGroup(owner, name);
    for (const member of members) {
      await http.join(member, group);
    }
    return group;
  }

  async function save(member: TestMember, url: string, group?: GroupDetail) {
    const response = await http.request('POST', '/api/links', {
      authorization: member.authorization,
      body: { url, ...(group === undefined ? {} : { groupId: group.id }) },
    });
    expect(response.statusCode).toBe(201);
  }

  /** Siembra 50 links del grupo, todos compartidos por Ana en el mismo instante, y devuelve sus ids. */
  async function seedFifty(groupId: string): Promise<string[]> {
    const sharedAt = new Date('2026-09-17T10:00:00.000Z');
    const owner = new mongoose.Types.ObjectId(ana.userId);
    const jobLinks = [];
    const relations = [];
    for (let index = 0; index < 50; index += 1) {
      const linkId = new mongoose.Types.ObjectId();
      const draft = jobLinkDraft(
        `https://empresa.example/careers/paginado-${index}`,
        { createdBy: ana.userId, now: sharedAt },
      );
      jobLinks.push({
        _id: linkId,
        normalizedUrl: draft.normalizedUrl,
        urlHash: draft.urlHash,
        dedupeKey: draft.dedupeKey,
        platform: draft.platform,
        displayUrl: draft.displayUrl,
        originalUrls: [...draft.originalUrls],
        previewStatus: draft.previewStatus,
        previewVersion: draft.previewVersion,
        createdBy: owner,
        createdAt: sharedAt,
        updatedAt: sharedAt,
      });
      relations.push({
        groupId: new mongoose.Types.ObjectId(groupId),
        linkId,
        sharedBy: owner,
        sharedAt,
      });
    }
    await http.connection.collection(JOB_LINKS_COLLECTION).insertMany(jobLinks);
    await http.connection
      .collection(GROUP_LINKS_COLLECTION)
      .insertMany(relations);
    return jobLinks.map((document) => document._id.toHexString());
  }

  async function listGroup(
    member: TestMember,
    groupId: string,
    query = '',
  ): Promise<LinkPage> {
    const response = await http.request(
      'GET',
      `/api/groups/${groupId}/links${query}`,
      { authorization: member.authorization },
    );
    expect(response.statusCode).toBe(200);
    return linkPageSchema.parse(response.json());
  }

  it('Miembro ve los links del grupo', async () => {
    const group = await groupOf(ana, 'Backend Bolivia', beto);
    await save(ana, JOB_PAGE, group);
    await save(beto, COMPUTRABAJO, group);

    const page = await listGroup(beto, group.id);

    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.displayUrl)).toEqual([
      COMPUTRABAJO,
      JOB_PAGE,
    ]);
    expect(page.items.map((item) => item.sharedBy?.displayName)).toEqual([
      'Beto',
      'Ana',
    ]);
    expect(page.items[0]?.previewStatus).toBe('pending');
    expect(page.nextCursor).toBeUndefined();
  });

  it('answers when the reading of each offer was asked for', async () => {
    const group = await groupOf(ana, 'Lectura pedida');
    await save(ana, JOB_PAGE, group);
    // Un link de antes de `link-enrichment`: se guardó sin `previewRequestedAt` y el listado no puede romperse por eso.
    const legacyAt = new Date('2026-01-02T03:04:05.000Z');
    const legacy = jobLinkDraft('https://empresa.example/careers/antiguo', {
      createdBy: ana.userId,
      now: legacyAt,
    });
    const legacyId = new mongoose.Types.ObjectId();
    await http.connection.collection(JOB_LINKS_COLLECTION).insertOne({
      _id: legacyId,
      normalizedUrl: legacy.normalizedUrl,
      urlHash: legacy.urlHash,
      dedupeKey: legacy.dedupeKey,
      platform: legacy.platform,
      displayUrl: legacy.displayUrl,
      originalUrls: [...legacy.originalUrls],
      previewStatus: legacy.previewStatus,
      previewVersion: legacy.previewVersion,
      createdBy: new mongoose.Types.ObjectId(ana.userId),
      createdAt: legacyAt,
      updatedAt: legacyAt,
    });
    await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new mongoose.Types.ObjectId(group.id),
      linkId: legacyId,
      sharedBy: new mongoose.Types.ObjectId(ana.userId),
      sharedAt: legacyAt,
    });

    const page = await listGroup(ana, group.id);
    const saved = page.items.find((item) => item.displayUrl === JOB_PAGE);
    const old = page.items.find((item) => item.id === legacyId.toHexString());

    expect(saved?.previewRequestedAt).toBeDefined();
    expect(old?.previewRequestedAt).toBe(legacyAt.toISOString());
  });

  it('Oferta enriquecida', async () => {
    const group = await groupOf(ana, 'Oferta leída', beto);
    const readAt = new Date('2026-09-18T11:00:00.000Z');
    const draft = jobLinkDraft('https://empresa.example/careers/leida', {
      createdBy: ana.userId,
      now: readAt,
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
      previewStatus: 'manual',
      previewVersion: 3,
      ...enrichedPreview(ana.userId),
      previewRequestedAt: readAt,
      createdBy: new mongoose.Types.ObjectId(ana.userId),
      createdAt: readAt,
      updatedAt: readAt,
    });
    await http.connection.collection(GROUP_LINKS_COLLECTION).insertOne({
      groupId: new mongoose.Types.ObjectId(group.id),
      linkId,
      sharedBy: new mongoose.Types.ObjectId(ana.userId),
      sharedAt: readAt,
    });

    const page = await listGroup(beto, group.id);
    const item = page.items[0];

    expect(item?.previewStatus).toBe('manual');
    expect(item?.previewVersion).toBe(3);
    expect(item?.preview).toEqual({
      title: 'Backend Engineer',
      company: 'Acme Bolivia',
      location: 'La Paz, Bolivia',
      modality: 'remote',
    });
    expect(item?.previewSources?.title?.source).toBe('auto');
    expect(
      item?.previewSources?.company?.source === 'manual'
        ? item.previewSources.company.by
        : undefined,
    ).toEqual({ userId: ana.userId, displayName: 'Ana' });
  });

  it('a pending link keeps answering exactly like before', async () => {
    const group = await groupOf(ana, 'Sin leer todavía');
    await save(ana, JOB_PAGE, group);

    const page = await listGroup(ana, group.id);
    const item = page.items[0];

    expect(item?.previewStatus).toBe('pending');
    expect(item?.previewVersion).toBe(1);
    expect(item?.preview).toBeUndefined();
    expect(item?.previewSources).toBeUndefined();
    expect(item?.lastEnrichmentError).toBeUndefined();
  });

  it('Paginación sin saltos ni repetidos', async () => {
    const group = await groupOf(ana, 'Muchos links');
    // Los 50 links se siembran con una escritura por colección y todos con el mismo `sharedAt`, que es el caso que la
    // paginación tiene que resolver. Importarlos por HTTP serían 50 transacciones, y lo que se prueba aquí es el
    // recorrido de las páginas, no el alta (eso es "Importar un chat", con su propio escenario).
    const saved = await seedFifty(group.id);

    const seen: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const current = await listGroup(
        ana,
        group.id,
        `?limit=20${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
      );
      expect(current.total).toBe(50);
      seen.push(...current.items.map((item) => item.id));
      cursor = current.nextCursor;
      if (cursor === undefined) {
        break;
      }
    }

    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
    expect(new Set(seen)).toEqual(new Set(saved));
  });

  it('keeps the same total no matter the page size', async () => {
    const group = await groupOf(ana, 'Total estable');
    await save(ana, JOB_PAGE, group);
    await save(ana, COMPUTRABAJO, group);

    const byOne = await listGroup(ana, group.id, '?limit=1');
    const byFifty = await listGroup(ana, group.id, '?limit=50');

    expect(byOne.items).toHaveLength(1);
    expect(byOne.total).toBe(2);
    expect(byFifty.total).toBe(2);
    expect(byOne.nextCursor).toBeDefined();
  });

  it('answers 400 naming the cursor when it was manipulated', async () => {
    const group = await groupOf(ana, 'Cursor roto');

    const response = await http.request(
      'GET',
      `/api/groups/${group.id}/links?cursor=roto`,
      { authorization: ana.authorization },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'validation_error',
      message: 'Invalid request',
      fields: ['cursor'],
    });
  });

  it('answers 400 for a limit out of range', async () => {
    const group = await groupOf(ana, 'Límite');

    const response = await http.request(
      'GET',
      `/api/groups/${group.id}/links?limit=100`,
      { authorization: ana.authorization },
    );

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'validation_error',
      message: 'Invalid request',
      fields: ['limit'],
    });
  });

  it('Extraño no ve los links', async () => {
    const group = await groupOf(ana, 'Privado del grupo');
    await save(ana, JOB_PAGE, group);

    const foreign = await http.request('GET', `/api/groups/${group.id}/links`, {
      authorization: stranger.authorization,
    });
    const malformed = await http.request(
      'GET',
      `/api/groups/${MALFORMED_ID}/links`,
      { authorization: stranger.authorization },
    );

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'group_not_found',
      message: 'Group not found',
    });
    expect(malformed.statusCode).toBe(404);
    expect(malformed.json()).toEqual(foreign.json());
  });

  it('Lista privada', async () => {
    const carla = await http.authenticated('Carla');
    const group = await groupOf(carla, 'De Carla');
    await save(carla, JOB_PAGE);
    await save(carla, COMPUTRABAJO, group);

    const response = await http.request('GET', '/api/links/mine', {
      authorization: carla.authorization,
    });

    expect(response.statusCode).toBe(200);
    const page = linkPageSchema.parse(response.json());
    expect(page.total).toBe(1);
    expect(page.items.map((item) => item.displayUrl)).toEqual([JOB_PAGE]);
    expect(page.items[0]?.sharedBy).toBeUndefined();
  });

  it('does not show in the private list what somebody else saved', async () => {
    const dani = await http.authenticated('Dani');

    const response = await http.request('GET', '/api/links/mine', {
      authorization: dani.authorization,
    });

    expect(linkPageSchema.parse(response.json())).toEqual({
      items: [],
      total: 0,
    });
  });
});
