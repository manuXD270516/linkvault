import { CV_TEXT_PREVIEW_CHARS } from '@linkvault/shared';
import { getMongoTestUri } from '@linkvault/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  AttemptOutcome,
  FixedWindowCounter,
} from '../../../infrastructure/limits/fixed-window-counter';
import {
  createCvTestApp,
  previewBody,
  type CvTestApp,
  type TestPerson,
} from '../../../test-support/cv-test-app';

// `GET /api/cv`, `PUT /api/cv/:id/default`, `DELETE /api/cv/:id` y `GET /api/cv/:id/text-preview` por HTTP
// (tareas 6.7, 6.8, 6.9 y 6.11). Aquí se comprueba, sobre todo, **qué no sale**: ni el texto, ni la marca de recorte,
// ni la clave del objeto, ni nada de otra persona.

/** Contador con la ventana de vistas previas agotada, para el `429` con su espera. */
class SpentPreviewCounter implements FixedWindowCounter {
  consume(key: string): Promise<AttemptOutcome | null> {
    return Promise.resolve(
      key.startsWith('cv:text-preview:')
        ? { allowed: false, retryAfterSeconds: 742 }
        : { allowed: true, retryAfterSeconds: 0 },
    );
  }

  reset(): Promise<boolean> {
    return Promise.resolve(true);
  }

  giveBack(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

let http: CvTestApp;
let ana: TestPerson;
let beto: TestPerson;

beforeAll(async () => {
  http = await createCvTestApp('cv-documents', getMongoTestUri());
  ana = await http.authenticated();
  beto = await http.authenticated();
}, 60_000);

afterAll(async () => {
  await http.close();
});

describe('GET /api/cv', () => {
  it('Lista con tres versiones', async () => {
    const person = await http.authenticated();
    const first = await http.uploadPdf(person, 'primero.pdf');
    const second = await http.uploadPdf(person, 'segundo.pdf');
    const third = await http.uploadPdf(person, 'tercero.pdf');

    const items = await http.list(person);

    expect(items.map((cv) => cv.id)).toEqual([third.id, second.id, first.id]);
    expect(items.map((cv) => cv.version)).toEqual([3, 2, 1]);
    expect(items.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      third.id,
    ]);
  });

  it('Lista vacía', async () => {
    await expect(http.list(beto)).resolves.toEqual([]);
  });

  it('La lista es solo mía', async () => {
    const mine = await http.uploadPdf(ana);

    await expect(http.list(beto)).resolves.toEqual([]);
    await expect(http.list(ana)).resolves.toMatchObject([{ id: mine.id }]);
  });
});

describe('PUT /api/cv/:id/default', () => {
  it('Volver a la anterior', async () => {
    const person = await http.authenticated();
    const first = await http.uploadPdf(person);
    await http.uploadPdf(person);

    const response = await http.request(
      'PUT',
      `/api/cv/${first.id}/default`,
      { authorization: person.authorization },
    );

    expect(response.statusCode).toBe(200);
    const { items } = response.json<{ items: { id: string; isDefault: boolean }[] }>();
    expect(items.filter((cv) => cv.isDefault).map((cv) => cv.id)).toEqual([
      first.id,
    ]);
  });

  it('Marcar el que ya lo es', async () => {
    const person = await http.authenticated();
    const only = await http.uploadPdf(person);

    const response = await http.request('PUT', `/api/cv/${only.id}/default`, {
      authorization: person.authorization,
    });

    expect(response.statusCode).toBe(200);
    await expect(http.list(person)).resolves.toMatchObject([
      { id: only.id, isDefault: true },
    ]);
  });

  it('Identificador mal formado', async () => {
    const response = await http.request('PUT', '/api/cv/no-es-un-id/default', {
      authorization: ana.authorization,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'cv_not_found' });
  });
});

describe('DELETE /api/cv/:id', () => {
  it('Eliminar: devuelve la lista y deja el evento pendiente', async () => {
    const person = await http.authenticated();
    const first = await http.uploadPdf(person);
    const second = await http.uploadPdf(person);

    const response = await http.request('DELETE', `/api/cv/${first.id}`, {
      authorization: person.authorization,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [{ id: second.id }] });
    await expect(
      http.connection.collection('outbox_events').countDocuments({
        type: 'CvDeleted.v1',
        'payload.cvId': first.id,
        publishedAt: null,
      }),
    ).resolves.toBe(1);
  });

  it('El almacén no responde al borrar: se borra igual y el evento queda pendiente', async () => {
    // Borrar no habla con el almacén —el puerto de `api` ni siquiera tiene un método para hacerlo—, y esa es justo la
    // promesa: con el almacén caído la persona ve su CV borrado, y el archivo se lo lleva el consumidor de la cola
    // cuando el almacén vuelva.
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person);
    http.files.failure = new Error('Connection refused');
    try {
      const response = await http.request('DELETE', `/api/cv/${saved.id}`, {
        authorization: person.authorization,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ items: [] });
      await expect(http.list(person)).resolves.toEqual([]);
      await expect(
        http.connection.collection('outbox_events').countDocuments({
          type: 'CvDeleted.v1',
          'payload.cvId': saved.id,
          publishedAt: null,
        }),
      ).resolves.toBe(1);
    } finally {
      http.files.failure = undefined;
    }
  });

  it('Borrar dos veces', async () => {
    const person = await http.authenticated();
    const only = await http.uploadPdf(person);
    await http.request('DELETE', `/api/cv/${only.id}`, {
      authorization: person.authorization,
    });

    const second = await http.request('DELETE', `/api/cv/${only.id}`, {
      authorization: person.authorization,
    });

    expect(second.statusCode).toBe(404);
    expect(second.json()).toMatchObject({ code: 'cv_not_found' });
  });

  it('Borrar el marcado promueve al más reciente de los que quedan', async () => {
    const person = await http.authenticated();
    const first = await http.uploadPdf(person);
    const second = await http.uploadPdf(person);
    const third = await http.uploadPdf(person);

    const response = await http.request('DELETE', `/api/cv/${third.id}`, {
      authorization: person.authorization,
    });

    expect(response.statusCode).toBe(200);
    const { items } = response.json<{ items: { id: string; isDefault: boolean }[] }>();
    expect(items.map((cv) => cv.id)).toEqual([second.id, first.id]);
    expect(items.find((cv) => cv.isDefault)?.id).toBe(second.id);
  });
});

describe('GET /api/cv/:id/text-preview', () => {
  it('Ver lo leído, sin caché y cortado en límite de palabra', async () => {
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person);
    await http.withExtractedText(
      saved.id,
      `${'palabra '.repeat(1200)}final`.trim(),
    );

    const response = await http.preview(person, saved.id);

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = previewBody(response);
    expect(body.status).toBe('extracted');
    expect(body.chars).toBeLessThanOrEqual(CV_TEXT_PREVIEW_CHARS);
    expect(body.complete).toBe(false);
    expect(body.text.endsWith('palabra')).toBe(true);
  });

  it('Un CV corto se ve entero', async () => {
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person);
    await http.withExtractedText(saved.id, 'a'.repeat(900));

    const body = previewBody(await http.preview(person, saved.id));

    expect(body).toEqual({
      status: 'extracted',
      text: 'a'.repeat(900),
      chars: 900,
      complete: true,
    });
  });

  it('Justo 2.000 caracteres', async () => {
    const person = await http.authenticated();
    const exact = await http.uploadPdf(person);
    await http.withExtractedText(exact.id, 'b'.repeat(CV_TEXT_PREVIEW_CHARS));
    const longer = await http.uploadPdf(person);
    await http.withExtractedText(longer.id, 'c'.repeat(50_000));

    expect(previewBody(await http.preview(person, exact.id))).toMatchObject({
      chars: CV_TEXT_PREVIEW_CHARS,
      complete: true,
    });
    expect(previewBody(await http.preview(person, longer.id))).toMatchObject({
      chars: CV_TEXT_PREVIEW_CHARS,
      complete: false,
    });
  });

  it('Todavía no hay texto y Un CV que no se pudo leer se distinguen', async () => {
    const person = await http.authenticated();
    const pending = await http.uploadPdf(person);
    const failed = await http.uploadPdf(person);
    await http.connection
      .collection('cv_documents')
      .updateOne(
        { _id: new http.connection.base.Types.ObjectId(failed.id) },
        {
          $set: {
            'extraction.status': 'failed',
            'extraction.failureReason': 'no_text',
          },
        },
      );

    const stillReading = previewBody(await http.preview(person, pending.id));
    const unreadable = previewBody(await http.preview(person, failed.id));

    expect(stillReading).toEqual({
      status: 'pending',
      text: '',
      chars: 0,
      complete: false,
    });
    expect(unreadable.status).toBe('failed');
    expect(stillReading).not.toEqual(unreadable);
  });

  it('CV borrado en otra pestaña', async () => {
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person);
    await http.request('DELETE', `/api/cv/${saved.id}`, {
      authorization: person.authorization,
    });

    const response = await http.preview(person, saved.id);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 'cv_not_found' });
  });

  it('Demasiadas vistas previas', async () => {
    const own = await createCvTestApp('cv-preview-window', getMongoTestUri(), {
      counter: new SpentPreviewCounter(),
    });
    try {
      const person = await own.authenticated();
      const saved = await own.uploadPdf(person);

      const response = await own.preview(person, saved.id);

      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 'too_many_attempts' });
      expect(response.headers['retry-after']).toBe('742');
    } finally {
      await own.close();
    }
  }, 60_000);
});

describe('every CV belongs to its owner and to nobody else', () => {
  it('El CV de otra persona responde el mismo 404 en las tres rutas', async () => {
    const owner = await http.authenticated();
    const saved = await http.uploadPdf(owner);

    const responses = await Promise.all([
      http.preview(beto, saved.id),
      http.request('PUT', `/api/cv/${saved.id}/default`, {
        authorization: beto.authorization,
      }),
      http.request('DELETE', `/api/cv/${saved.id}`, {
        authorization: beto.authorization,
      }),
    ]);

    for (const response of responses) {
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({
        code: 'cv_not_found',
        message: expect.any(String),
      });
    }
    await expect(http.list(owner)).resolves.toMatchObject([{ id: saved.id }]);
  });

  it('Sin sesión no hay nada', async () => {
    const saved = await http.uploadPdf(ana);

    const listing = await http.request('GET', '/api/cv');
    const preview = await http.request(
      'GET',
      `/api/cv/${saved.id}/text-preview`,
    );

    expect(listing.statusCode).toBe(401);
    expect(preview.statusCode).toBe(401);
  });
});

describe('the text never travels', () => {
  it('El texto completo no viaja en la subida, el listado ni el marcado', async () => {
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person, 'CV_Ana_Perez.pdf');
    const secret = 'ingeniera de software inventada para esta prueba';
    await http.withExtractedText(saved.id, `${secret} ${'x'.repeat(300_000)}`);

    const listing = await http.request('GET', '/api/cv', {
      authorization: person.authorization,
    });
    const marked = await http.request('PUT', `/api/cv/${saved.id}/default`, {
      authorization: person.authorization,
    });

    for (const response of [listing, marked]) {
      expect(response.body).not.toContain(secret);
      expect(response.body).not.toContain('extractedText');
      expect(response.body).not.toContain('truncated');
      expect(response.body).not.toContain('fileKey');
      expect(response.body).not.toContain(person.userId);
    }
  });

  it('No hay ruta de descarga: el inventario de rutas de /api/cv no nombra el archivo', () => {
    const printed = http.app
      .getHttpAdapter()
      .getInstance()
      .printRoutes({ commonPrefix: false });

    // Las cinco que sí existen, y ni una palabra que suene a devolver los bytes.
    expect(printed).toContain('text-preview');
    expect(printed).toContain('default');
    for (const forbidden of ['file', 'download', 'raw', 'content', 'binary']) {
      expect(new RegExp(`cv[^\\n]*${forbidden}`, 'i').test(printed)).toBe(false);
    }
  });

  it.each([
    'file',
    'download',
    'raw',
    'original',
  ])('answers 404 to a made-up /api/cv/:id/%s', async (segment) => {
    const person = await http.authenticated();
    const saved = await http.uploadPdf(person);

    const response = await http.request(
      'GET',
      `/api/cv/${saved.id}/${segment}`,
      { authorization: person.authorization },
    );

    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('%PDF');
  });
});
