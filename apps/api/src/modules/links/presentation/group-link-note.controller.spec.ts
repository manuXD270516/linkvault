import {
  apiErrorResponseSchema,
  linkPageSchema,
  type JobLinkSummary,
} from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCommentsTestApp,
  type CommentsTestApp,
} from '../../../test-support/comments-test-app';
import { JOB_LINKS_COLLECTION } from '../infrastructure/link.schemas';

// La nota de quien comparte por HTTP (tarea 5.5 de group-comments): `note` en `POST /api/links` y
// `DELETE /api/groups/:id/links/:linkId/note`, con el orden pertenencia → relación → permiso → borrado.

let fx: CommentsTestApp;
let urls = 0;

beforeAll(async () => {
  fx = await createCommentsTestApp('note-http', getMongoTestUri());
});

afterAll(async () => {
  await fx.close();
});

function nextUrl(): string {
  urls += 1;
  return `https://empresa.example/careers/nota-${urls}`;
}

async function listed(linkId: string): Promise<JobLinkSummary | undefined> {
  const response = await fx.http.request(
    'GET',
    `/api/groups/${fx.group.id}/links?limit=50`,
    { authorization: fx.ana.authorization },
  );
  return linkPageSchema
    .parse(response.json())
    .items.find((item) => item.id === linkId);
}

function removeNote(
  member: CommentsTestApp['ana'],
  linkId: string,
  groupId = fx.group.id,
) {
  return fx.http.request('DELETE', `/api/groups/${groupId}/links/${linkId}/note`, {
    authorization: member.authorization,
  });
}

describe('note in POST /api/links', () => {
  it('Guardar con una nota', async () => {
    const saved = await fx.save(fx.ana, nextUrl(), {
      groupId: fx.group.id,
      note: '  Esta es la que te dije ',
    });

    expect(saved.link.note?.text).toBe('Esta es la que te dije');
    expect((await listed(saved.link.id))?.note?.text).toBe(
      'Esta es la que te dije',
    );
  });

  it('La nota del primero se queda', async () => {
    const url = nextUrl();
    const first = await fx.save(fx.ana, url, {
      groupId: fx.group.id,
      note: 'Esta es la que te dije',
    });

    const second = await fx.save(fx.beto, url, {
      groupId: fx.group.id,
      note: 'Yo también la vi',
    });

    expect(second.shared).toBe('already_there');
    expect((await listed(first.link.id))?.note?.text).toBe(
      'Esta es la que te dije',
    );
  });

  it('Nota sin grupo: 400 naming note, and no link stored', async () => {
    const before = await fx.http.connection
      .collection(JOB_LINKS_COLLECTION)
      .countDocuments();

    const response = await fx.http.request('POST', '/api/links', {
      authorization: fx.ana.authorization,
      body: { url: nextUrl(), note: 'Para mí' },
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      code: 'validation_error',
      fields: ['note'],
    });
    expect(
      await fx.http.connection.collection(JOB_LINKS_COLLECTION).countDocuments(),
    ).toBe(before);
  });

  it('Nota vacía sin grupo: 201 in the private list', async () => {
    const saved = await fx.save(fx.ana, nextUrl(), { note: '   ' });

    expect(saved.link.note).toBeUndefined();
    const mine = await fx.http.request('GET', '/api/links/mine', {
      authorization: fx.ana.authorization,
    });
    expect(
      linkPageSchema.parse(mine.json()).items.map((item) => item.id),
    ).toContain(saved.link.id);
  });

  it('Nota demasiado larga: 400 naming note', async () => {
    const response = await fx.http.request('POST', '/api/links', {
      authorization: fx.ana.authorization,
      body: { url: nextUrl(), groupId: fx.group.id, note: 'a'.repeat(281) },
    });

    expect(response.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(response.json())).toMatchObject({
      fields: ['note'],
    });
  });

  it('Importar no escribe notas', async () => {
    const url = nextUrl();
    const response = await fx.http.request('POST', '/api/links/import', {
      authorization: fx.ana.authorization,
      body: { text: `Mira ${url}`, groupId: fx.group.id, note: 'Para todos' },
    });

    expect(response.statusCode).toBe(201);
    const linkId = response.json<{ links: { id: string }[] }>().links[0]?.id;
    expect((await listed(linkId ?? ''))?.note).toBeUndefined();
  });

  it('La lista privada no trae comentarios', async () => {
    const url = nextUrl();
    const inGroup = await fx.save(fx.ana, url, {
      groupId: fx.group.id,
      note: 'Mira',
    });
    await fx.post(fx.beto, inGroup.link.id, 'Comentario');
    await fx.save(fx.ana, url);

    const mine = await fx.http.request('GET', '/api/links/mine', {
      authorization: fx.ana.authorization,
    });
    const item = linkPageSchema
      .parse(mine.json())
      .items.find((entry) => entry.id === inGroup.link.id);

    expect(item).toBeDefined();
    expect(item?.note).toBeUndefined();
    expect(item?.comments).toBeUndefined();
  });
});

describe('DELETE /api/groups/:id/links/:linkId/note', () => {
  it('Quien compartió quita su nota', async () => {
    const saved = await fx.save(fx.ana, nextUrl(), {
      groupId: fx.group.id,
      note: 'Esta es la que te dije',
    });

    const response = await removeNote(fx.ana, saved.link.id);

    expect(response.statusCode).toBe(204);
    expect((await listed(saved.link.id))?.note).toBeUndefined();
  });

  it('El propietario quita una nota ajena, and the link stays', async () => {
    const saved = await fx.save(fx.beto, nextUrl(), {
      groupId: fx.group.id,
      note: 'De Beto',
    });

    const response = await removeNote(fx.ana, saved.link.id);

    expect(response.statusCode).toBe(204);
    const item = await listed(saved.link.id);
    expect(item).toBeDefined();
    expect(item?.note).toBeUndefined();
  });

  it('Otro miembro no la quita: 403, and the note stays', async () => {
    const saved = await fx.save(fx.beto, nextUrl(), {
      groupId: fx.group.id,
      note: 'De Beto',
    });

    const response = await removeNote(fx.carla, saved.link.id);

    expect(response.statusCode).toBe(403);
    expect(apiErrorResponseSchema.parse(response.json()).code).toBe('forbidden');
    expect((await listed(saved.link.id))?.note?.text).toBe('De Beto');
  });

  it('Quitar una nota que ya no está: 204 again', async () => {
    const saved = await fx.save(fx.ana, nextUrl(), {
      groupId: fx.group.id,
      note: 'Una vez',
    });
    await removeNote(fx.ana, saved.link.id);

    expect((await removeNote(fx.ana, saved.link.id)).statusCode).toBe(204);
  });

  it('Sin permiso aunque no haya nota: 403', async () => {
    const saved = await fx.save(fx.beto, nextUrl(), { groupId: fx.group.id });

    const response = await removeNote(fx.carla, saved.link.id);

    expect(response.statusCode).toBe(403);
  });

  it('checks membership first and the relation second', async () => {
    const saved = await fx.save(fx.beto, nextUrl(), {
      groupId: fx.group.id,
      note: 'De Beto',
    });

    const stranger = await removeNote(fx.stranger, saved.link.id);
    const missing = await removeNote(fx.carla, '66e9a00000000000000000ee');

    expect(stranger.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(stranger.json()).code).toBe(
      'group_not_found',
    );
    expect(missing.statusCode).toBe(404);
    expect(apiErrorResponseSchema.parse(missing.json()).code).toBe(
      'link_not_found',
    );
  });

  it('La nota no se edita: PATCH answers 404 and the note stays', async () => {
    const saved = await fx.save(fx.ana, nextUrl(), {
      groupId: fx.group.id,
      note: 'Original',
    });

    const response = await fx.http.request(
      'PATCH',
      `/api/groups/${fx.group.id}/links/${saved.link.id}/note`,
      { authorization: fx.ana.authorization, body: { text: 'Cambiada' } },
    );

    expect(response.statusCode).toBe(404);
    expect((await listed(saved.link.id))?.note?.text).toBe('Original');
  });
});
