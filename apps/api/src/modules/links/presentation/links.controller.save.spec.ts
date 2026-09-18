import {
  apiErrorResponseSchema,
  importLinksResponseSchema,
  saveLinkResponseSchema,
  type GroupDetail,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createLinksTestApp,
  type LinksTestApp,
  type TestMember,
} from '../../../test-support/links-test-app';
import { MAX_IMPORT_TEXT_LENGTH, MAX_LINKS_PER_IMPORT } from '../domain/limits';
import { JOB_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// `POST /api/links` y `POST /api/links/import` (tarea 5.7 de job-links) sobre la app completa con el Mongo del preset.

const MALFORMED_ID = 'no-es-un-id';
const JOB_PAGE = 'https://www.linkedin.com/jobs/view/3811111111/';
const SEARCH_PAGE =
  'https://www.linkedin.com/jobs/search/?currentJobId=3811111111';
const COMPUTRABAJO =
  'https://bo.computrabajo.com/acme/ofertas-de-trabajo/oferta-de-trabajo-de-backend-en-la-paz-a1b2c3d4e5f60718';
const CAREERS = 'https://empresa.example/careers/backend';

describe('POST /api/links', () => {
  let http: LinksTestApp;
  let ana: TestMember;
  let group: GroupDetail;

  beforeAll(async () => {
    http = await createLinksTestApp('links-save-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
    group = await http.createGroup(ana);
  });

  afterAll(async () => {
    await http.close();
  });

  /** Grupo nuevo de `owner`, para que cada escenario tenga su propia lista. */
  async function ownGroup(owner: TestMember, name: string) {
    return await http.createGroup(owner, name);
  }

  function save(member: TestMember, body: unknown) {
    return http.request('POST', '/api/links', {
      authorization: member.authorization,
      body,
    });
  }

  it('Guardar en un grupo', async () => {
    const response = await save(ana, { url: JOB_PAGE, groupId: group.id });

    expect(response.statusCode).toBe(201);
    const body = saveLinkResponseSchema.parse(response.json());
    expect(body.created).toBe(true);
    expect(body.shared).toBe('created');
    expect(body.link.previewStatus).toBe('pending');
    expect(body.link.platform).toBe('linkedin');
    expect(body.link.displayUrl).toBe(JOB_PAGE);
    expect(body.link.sharedBy).toEqual({
      userId: ana.userId,
      displayName: 'Ana',
    });
    expect(body.alreadyInGroups).toEqual([]);

    const list = await http.request('GET', `/api/groups/${group.id}/links`, {
      authorization: ana.authorization,
    });
    expect(list.json<{ items: { id: string }[] }>().items[0]?.id).toBe(
      body.link.id,
    );
  });

  it('Guardar en privado', async () => {
    const beto = await http.authenticated('Beto');

    const response = await save(beto, { url: COMPUTRABAJO });

    expect(response.statusCode).toBe(201);
    const body = saveLinkResponseSchema.parse(response.json());
    expect(body.link.sharedBy).toBeUndefined();
    expect(body.sharedBy).toBeUndefined();

    const mine = await http.request('GET', '/api/links/mine', {
      authorization: beto.authorization,
    });
    expect(mine.json<{ total: number }>().total).toBe(1);
  });

  it('writes the vacancy and its outbox event in the same transaction', async () => {
    const carla = await http.authenticated('Carla');
    const response = await save(carla, {
      url: 'https://www.indeed.com/viewjob?jk=1a2b3c4d5e6f7a8b',
    });

    const { link } = saveLinkResponseSchema.parse(response.json());
    const event = await http.connection
      .collection('outbox_events')
      .findOne({ 'payload.linkId': link.id });

    expect(event?.['type']).toBe('LinkCreated.v1');
    expect(event?.['publishedAt']).toBeNull();
  });

  it('URL no reconocida', async () => {
    const response = await save(ana, {
      url: 'no-es-una-url',
      groupId: group.id,
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'invalid_url',
      message: 'That does not look like a job link',
    });
  });

  it('Grupo ajeno', async () => {
    const stranger = await http.authenticated('Extraño');
    const theirs = await ownGroup(stranger, 'De otro');

    const foreign = await save(ana, { url: JOB_PAGE, groupId: theirs.id });
    const malformed = await save(ana, {
      url: JOB_PAGE,
      groupId: MALFORMED_ID,
    });

    expect(foreign.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(foreign.json()).toEqual({
      code: 'group_not_found',
      message: 'Group not found',
    });
    expect(malformed.json()).toEqual(foreign.json());
  });

  it('answers 400 validation_error for a body without url', async () => {
    const response = await save(ana, { groupId: group.id });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      code: 'validation_error',
      message: 'Invalid request',
      fields: ['url'],
    });
  });

  it('shares the same vacancy twice without duplicating it', async () => {
    const beto = await http.authenticated('Beto');
    const shared = await ownGroup(ana, 'Compartido');
    await http.join(beto, shared);
    const first = await save(ana, { url: JOB_PAGE, groupId: shared.id });

    const second = await save(beto, { url: SEARCH_PAGE, groupId: shared.id });

    expect(second.statusCode).toBe(201);
    const body = saveLinkResponseSchema.parse(second.json());
    expect(body.created).toBe(false);
    expect(body.shared).toBe('already_there');
    expect(body.sharedBy).toEqual({ userId: ana.userId, displayName: 'Ana' });
    expect(body.link.id).toBe(
      saveLinkResponseSchema.parse(first.json()).link.id,
    );

    const list = await http.request('GET', `/api/groups/${shared.id}/links`, {
      authorization: beto.authorization,
    });
    expect(list.json<{ total: number }>().total).toBe(1);
  });

  it('tells in which other own group the link already was', async () => {
    const owner = await http.authenticated('Dani');
    const backend = await ownGroup(owner, 'Backend Bolivia');
    const frontend = await ownGroup(owner, 'Frontend LatAm');
    await save(owner, { url: CAREERS, groupId: backend.id });

    const response = await save(owner, { url: CAREERS, groupId: frontend.id });

    expect(saveLinkResponseSchema.parse(response.json()).alreadyInGroups).toEqual(
      [{ id: backend.id, name: 'Backend Bolivia' }],
    );
  });
});

describe('POST /api/links/import', () => {
  let http: LinksTestApp;
  let ana: TestMember;

  beforeAll(async () => {
    http = await createLinksTestApp('links-import-http', getMongoTestUri());
    ana = await http.authenticated('Ana');
  });

  afterAll(async () => {
    await http.close();
  });

  function importChat(member: TestMember, body: unknown) {
    return http.request('POST', '/api/links/import', {
      authorization: member.authorization,
      body,
    });
  }

  it('Importar un chat', async () => {
    const group = await http.createGroup(ana, 'Chat');
    await http.request('POST', '/api/links', {
      authorization: ana.authorization,
      body: { url: CAREERS, groupId: group.id },
    });
    const chat = [
      `[17/9/2026, 10:02] Ana: miren esta ${JOB_PAGE}`,
      `[17/9/2026, 10:03] Beto: la misma ${SEARCH_PAGE}`,
      `[17/9/2026, 10:04] Ana: y esta (${COMPUTRABAJO})`,
      `[17/9/2026, 10:05] Beto: esta ya estaba ${CAREERS}`,
    ].join('\n');

    const response = await importChat(ana, { text: chat, groupId: group.id });

    expect(response.statusCode).toBe(201);
    const body = importLinksResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      created: 2,
      existing: 1,
      unrecognized: 0,
      skipped: 0,
    });
    const list = await http.request('GET', `/api/groups/${group.id}/links`, {
      authorization: ana.authorization,
    });
    expect(list.json<{ total: number }>().total).toBe(3);
  });

  it('Chat con más de 50 enlaces', async () => {
    const group = await http.createGroup(ana, 'Muchos');
    const chat = Array.from(
      { length: 60 },
      (_, index) => `https://empresa.example/careers/${index}`,
    ).join('\n');

    const response = await importChat(ana, { text: chat, groupId: group.id });

    expect(response.statusCode).toBe(201);
    const body = importLinksResponseSchema.parse(response.json());
    expect(body.created).toBe(MAX_LINKS_PER_IMPORT);
    expect(body.skipped).toBe(10);

    // Segunda pasada: avanza con los 10 que faltaban, sin saltarse ninguno.
    const again = importLinksResponseSchema.parse(
      (await importChat(ana, { text: chat, groupId: group.id })).json(),
    );
    expect(again).toMatchObject({ created: 10, existing: 50, skipped: 0 });
  });

  it('Texto demasiado largo', async () => {
    const group = await http.createGroup(ana, 'Largo');
    const url = 'https://empresa.example/careers/texto-largo';
    const text = `${url}\n${'a'.repeat(MAX_IMPORT_TEXT_LENGTH)}`;

    const response = await importChat(ana, { text, groupId: group.id });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toEqual({
      code: 'text_too_long',
      message: 'Text is too long',
    });
    expect(
      await http.connection
        .collection(JOB_LINKS_COLLECTION)
        .countDocuments({ normalizedUrl: url }),
    ).toBe(0);
  });

  it('never stores the imported text, not even the phone numbers in it', async () => {
    const group = await http.createGroup(ana, 'Privacidad');
    const chat = `[10:02] Ana Quispe (+591 70000000): ${JOB_PAGE}`;

    await importChat(ana, { text: chat, groupId: group.id });

    const collections = await http.connection.db?.collections();
    for (const collection of collections ?? []) {
      const documents = await collection.find({}).toArray();
      expect(JSON.stringify(documents)).not.toContain('70000000');
    }
  });

  it('answers 404 group_not_found when importing into a group of somebody else', async () => {
    const stranger = await http.authenticated('Extraño');
    const theirs = await http.createGroup(stranger, 'De otro');

    const response = await importChat(ana, {
      text: JOB_PAGE,
      groupId: theirs.id,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      code: 'group_not_found',
      message: 'Group not found',
    });
  });
});
